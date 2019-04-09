/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    buttonForCommand,
    guid,
} from "@atomist/automation-client";
import {
    anySatisfied,
    gitHubTeamVoter,
    GoalApprovalRequestVote,
    goals,
    IsDeployEnabled,
    not,
    ProductionEnvironment,
    slackFooter,
    slackQuestionMessage,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    StagingEnvironment,
    ToDefaultBranch,
    whenPushSatisfies,
} from "@atomist/sdm";
import {
    createSoftwareDeliveryMachine,
    DisableDeploy,
    EnableDeploy,
    gitHubGoalStatus,
    goalScheduling,
    goalState,
    IsInLocalMode,
} from "@atomist/sdm-core";
import {
    Build,
    buildAwareCodeTransforms,
} from "@atomist/sdm-pack-build";
import { changelogSupport } from "@atomist/sdm-pack-changelog/lib/changelog";
import { HasDockerfile } from "@atomist/sdm-pack-docker";
import { issueSupport } from "@atomist/sdm-pack-issue";
import {
    IsAtomistAutomationClient,
    IsNode,
} from "@atomist/sdm-pack-node";
import { PublishToS3 } from "@atomist/sdm-pack-s3";
import {
    IsMaven,
    MaterialChangeToJavaRepo,
} from "@atomist/sdm-pack-spring";
import { isSdmEnabled } from "@atomist/sdm/lib/api-helper/pushtest/configuration/configurationTests";
import {
    bold,
    channel,
    codeLine,
    italic,
    url,
} from "@atomist/slack-messages";
import {
    ApprovalCommand,
    CancelApprovalCommand,
} from "../command/approval";
import { BadgeSupport } from "../command/badge";
import { GenerateChangelog } from "../command/changelog";
import { CreateTag } from "../command/tag";
import {
    isNamed,
    isOrgNamed,
    isTeam,
    nameMatches,
} from "../support/identityPushTests";
import { MaterialChangeToNodeRepo } from "../support/materialChangeToNodeRepo";
import { addDockerSupport } from "./dockerSupport";
import { addGithubSupport } from "./githubSupport";
import {
    autoCodeInspection,
    autofix,
    build,
    BuildGoals,
    BuildReleaseAndHomebrewGoals,
    BuildReleaseGoals,
    DemoKubernetesDeployGoals,
    DockerGoals,
    DockerReleaseGoals,
    FixGoals,
    GlobalKubernetesDeployGoals,
    KubernetesDeployGoals,
    LocalGoals,
    MavenBuildGoals,
    MavenDockerReleaseGoals,
    MultiKubernetesDeployGoals,
    releaseTag,
    releaseVersion,
    SimpleDockerReleaseGoals,
    SimplifiedKubernetesDeployGoals,
    tag,
    version,
} from "./goals";
import { addHomebrewSupport } from "./homebrewSupport";
import { addMavenSupport } from "./mavenSupport";
import { addNodeSupport } from "./nodeSupport";
import { IsReleaseCommit } from "./release";
import { addTeamPolicies } from "./teamPolicies";
import { addFileVersionerSupport } from "./version";
import {
    htmltestInspection,
    IsJekyllProject,
    JekyllBuildAfterCheckout,
    webBuilder,
    WebNpmBuildAfterCheckout,
} from "./webSupport";

const AtomistHQWorkspace = "T095SFFBK";

export function machine(configuration: SoftwareDeliveryMachineConfiguration): SoftwareDeliveryMachine {

    const publishS3Images = new PublishToS3({
        uniqueName: "publish s3-images to s3",
        bucketName: "images-atomist",
        region: "us-east-1",
        filesToPublish: ["images/**/*"],
        pathTranslation: filepath => filepath.replace("images/", ""),
        pathToIndex: "images/",
        sync: true,
        isolated: true,
    });
    const S3ImagesGoals = goals("Image Publish").plan(publishS3Images);

    const buildWeb = new Build()
        .with({
            name: "web-npm-build",
            builder: webBuilder("public"),
            pushTest: IsNode,
        })
        .with({
            name: "web-jekyll-build",
            builder: webBuilder("_site"),
            pushTest: IsJekyllProject,
        });
    const WebBuildGoals = goals("Web Build")
        .plan(autofix)
        .plan(version).after(autofix)
        .plan(buildWeb).after(version)
        .plan(tag).after(buildWeb);

    autoCodeInspection.with(htmltestInspection("_site"));

    const publishWebAppToStaging = new PublishToS3({
        environment: StagingEnvironment,
        uniqueName: "publish web-app to staging s3 bucket",
        bucketName: "app-staging.atomist.services",
        region: "us-east-1",
        filesToPublish: ["public/**/*"],
        pathTranslation: filepath => filepath.replace("public/", ""),
        pathToIndex: "public/",
        sync: true,
        isolated: true,
    }).withProjectListener(WebNpmBuildAfterCheckout);
    const publishWebAppToProduction = new PublishToS3({
        environment: ProductionEnvironment,
        uniqueName: "publish web-app to production s3 bucket",
        bucketName: "app.atomist.com",
        region: "us-east-1",
        filesToPublish: ["public/**/*"],
        pathTranslation: filepath => filepath.replace("public/", ""),
        pathToIndex: "public/",
        sync: true,
        isolated: true,
        preApprovalRequired: true,
    }).withProjectListener(WebNpmBuildAfterCheckout);
    const WebAppGoals = goals("Web App Build with Release")
        .plan(WebBuildGoals)
        .plan(publishWebAppToStaging).after(buildWeb)
        .plan(publishWebAppToProduction).after(publishWebAppToStaging)
        .plan(releaseTag, releaseVersion).after(publishWebAppToProduction);

    const publishWebSiteToStaging = new PublishToS3({
        environment: StagingEnvironment,
        uniqueName: "publish web-site to staging s3 bucket",
        bucketName: "www-staging.atomist.services",
        region: "us-east-1",
        filesToPublish: ["_site/**/*"],
        paramsExt: ".s3params",
        pathTranslation: filepath => filepath.replace("_site/", ""),
        pathToIndex: "_site/",
        sync: true,
        isolated: true,
    }).withProjectListener(JekyllBuildAfterCheckout);
    const publishWebSiteToProduction = new PublishToS3({
        environment: ProductionEnvironment,
        uniqueName: "publish web-site to production s3 bucket",
        bucketName: "atomist.com",
        region: "us-east-1",
        filesToPublish: ["_site/**/*"],
        paramsExt: ".s3params",
        pathTranslation: filepath => filepath.replace("_site/", ""),
        pathToIndex: "_site/",
        sync: true,
        isolated: true,
        preApprovalRequired: true,
    }).withProjectListener(JekyllBuildAfterCheckout);
    const WebSiteGoals = goals("Web Site Build with Release")
        .plan(WebBuildGoals)
        .plan(publishWebSiteToStaging, autoCodeInspection).after(buildWeb)
        .plan(publishWebSiteToProduction).after(publishWebSiteToStaging)
        .plan(releaseTag, releaseVersion).after(publishWebSiteToProduction);

    const sdm = createSoftwareDeliveryMachine({
        name: "Atomist Software Delivery Machine",
        configuration,
    },

        whenPushSatisfies(isOrgNamed("atomist-playground"))
            .setGoals(goals("No Goals")),

        whenPushSatisfies(isOrgNamed("atomist-seeds"), not(nameMatches(/sdm/)))
            .itMeans("Non-Atomist seed")
            .setGoals(goals("No Goals")),

        whenPushSatisfies(isOrgNamed("sdd-manifesto"), isNamed("manifesto", "manifesto-app"))
            .itMeans("Manifesto repository")
            .setGoals(goals("No Goals")),

        whenPushSatisfies(IsReleaseCommit)
            .itMeans("Release commit")
            .setGoals(goals("No Goals")),

        whenPushSatisfies(IsNode, IsInLocalMode)
            .itMeans("Node repository in local mode")
            .setGoals(LocalGoals),

        whenPushSatisfies(isOrgNamed("atomisthq"), isNamed("s3-images"), ToDefaultBranch)
            .itMeans("Images Site Deploy")
            .setGoals(S3ImagesGoals),
        whenPushSatisfies(isOrgNamed("atomisthq"), isNamed("web-app"), ToDefaultBranch)
            .itMeans("Web App Deploy")
            .setGoals(WebAppGoals),
        whenPushSatisfies(isOrgNamed("atomisthq"), isNamed("web-site"), ToDefaultBranch)
            .itMeans("Web Site Deploy")
            .setGoals(WebSiteGoals),
        whenPushSatisfies(isOrgNamed("atomisthq"), isNamed("web-app", "web-app"))
            .itMeans("Web Build")
            .setGoals(WebBuildGoals),

        whenPushSatisfies(not(isSdmEnabled(configuration.name)), isTeam(AtomistHQWorkspace))
            .itMeans("Disabled repository in atomisthq workspace")
            .setGoals(goals("No Goals")),

        // Node
        whenPushSatisfies(IsNode, not(IsMaven), not(MaterialChangeToNodeRepo))
            .itMeans("No Material Change")
            .setGoals(FixGoals),

        // Maven
        whenPushSatisfies(IsMaven, not(MaterialChangeToJavaRepo))
            .itMeans("No Material Change")
            .setGoals(FixGoals),

        whenPushSatisfies(IsMaven, MaterialChangeToJavaRepo, not(ToDefaultBranch))
            .itMeans("Build Java")
            .setGoals(MavenBuildGoals),

        whenPushSatisfies(IsMaven, MaterialChangeToJavaRepo, HasDockerfile, ToDefaultBranch)
            .itMeans("Maven Docker Release Build")
            .setGoals(MavenDockerReleaseGoals),

        // Simplified deployment goal set for atomist-sdm, k8-automation; we are skipping
        // testing for these and deploying straight into their respective namespaces
        whenPushSatisfies(IsNode, HasDockerfile, ToDefaultBranch, IsAtomistAutomationClient,
            isNamed("atomist-sdm", "docs-sdm", "manifesto-sdm"))
            .itMeans("Simplified Deploy")
            .setGoals(SimplifiedKubernetesDeployGoals),

        // Deploy assets to "global" Kubernetes cluster
        whenPushSatisfies(IsNode, HasDockerfile, ToDefaultBranch, IsAtomistAutomationClient,
            isNamed("global-sdm"))
            .itMeans("Global Deploy")
            .setGoals(GlobalKubernetesDeployGoals),

        // Deploy k8s-sdm to all the clusters
        whenPushSatisfies(IsNode, HasDockerfile, ToDefaultBranch, IsAtomistAutomationClient,
            isNamed("k8s-sdm"))
            .itMeans("Multi Cluster Deploy")
            .setGoals(MultiKubernetesDeployGoals),

        // Deploy demo-sdm to demo cluster
        whenPushSatisfies(IsNode, HasDockerfile, ToDefaultBranch, IsAtomistAutomationClient,
            isNamed("demo-sdm"))
            .itMeans("Demo Cluster Deploy")
            .setGoals(DemoKubernetesDeployGoals),

        whenPushSatisfies(anySatisfied(IsNode), HasDockerfile, ToDefaultBranch, IsDeployEnabled)
            .itMeans("Deploy")
            .setGoals(KubernetesDeployGoals),

        whenPushSatisfies(anySatisfied(IsNode), HasDockerfile, ToDefaultBranch)
            .itMeans("Docker Release Build")
            .setGoals(DockerReleaseGoals),

        whenPushSatisfies(anySatisfied(IsNode), HasDockerfile)
            .itMeans("Docker Build")
            .setGoals(DockerGoals),

        whenPushSatisfies(HasDockerfile, isOrgNamed("atomist"))
            .itMeans("Simple Docker Release Build")
            .setGoals(SimpleDockerReleaseGoals),

        whenPushSatisfies(IsNode, not(HasDockerfile), ToDefaultBranch)
            .itMeans("Release Build")
            .setGoals(BuildReleaseGoals),

        whenPushSatisfies(isNamed("cli"), IsNode, not(HasDockerfile), ToDefaultBranch)
            .itMeans("Release Build")
            .setGoals(BuildReleaseAndHomebrewGoals),

        whenPushSatisfies(IsNode, not(HasDockerfile), ToDefaultBranch)
            .itMeans("Release Build")
            .setGoals(BuildReleaseGoals),

        whenPushSatisfies(IsNode, not(HasDockerfile))
            .itMeans("Build")
            .setGoals(BuildGoals),
    );

    sdm.addCommand(EnableDeploy)
        .addCommand(DisableDeploy)
        .addCommand(CreateTag)
        .addCommand(GenerateChangelog);

    addGithubSupport(sdm);
    addDockerSupport(sdm);
    addMavenSupport(sdm);
    addNodeSupport(sdm);
    addHomebrewSupport(sdm);
    addTeamPolicies(sdm);
    addFileVersionerSupport(sdm);

    sdm.addExtensionPacks(
        goalScheduling(),
        changelogSupport(),
        BadgeSupport,
        buildAwareCodeTransforms({
            buildGoal: build,
            issueCreation: {
                issueRouter: {
                    raiseIssue: async () => { /* intentionally left empty */
                    },
                },
            },
        }),
        goalState(),
        gitHubGoalStatus(),
        issueSupport({
            labelIssuesOnDeployment: true,
            closeCodeInspectionIssuesOnBranchDeletion: {
                enabled: true,
                source: sdm.configuration.name,
            },
        }),
    );

    sdm.addGoalApprovalRequestVoter(gitHubTeamVoter("atomist-automation"));
    sdm.addGoalApprovalRequestVoter(async gi => {
        if (gi.goal.data) {
            const data = JSON.parse(gi.goal.data);
            if (data.approved) {
                return {
                    vote: GoalApprovalRequestVote.Granted,
                };
            }
        }
        if (!gi.goal.approval) {
            return {
                vote: GoalApprovalRequestVote.Granted,
            };
        }

        const msgId = guid();
        const channelLink = (gi.goal.approval.channelId) ? ` | ${channel(gi.goal.approval.channelId)}` : "";
        const msg = slackQuestionMessage("Goal Approval", `Goal ${italic(gi.goal.url ? url(gi.goal.url, gi.goal.name) : gi.goal.name)} on ${
            codeLine(gi.goal.sha.slice(0, 7))} of ${
            bold(`${gi.goal.repo.owner}/${gi.goal.repo.name}/${gi.goal.branch}`)} requires your confirmation to approve`,
            {
                actions: [buttonForCommand(
                    { text: "Approve" },
                    "ApproveSdmGoalCommand",
                    {
                        goalSetId: gi.goal.goalSetId,
                        goalUniqueName: gi.goal.uniqueName,
                        goalState: gi.goal.state,
                        msgId,
                    }), buttonForCommand(
                        { text: "Cancel" },
                        "CancelApproveSdmGoalCommand",
                        {
                            goalSetId: gi.goal.goalSetId,
                            goalUniqueName: gi.goal.uniqueName,
                            goalState: gi.goal.state,
                            msgId,
                        })],
                footer: `${slackFooter()} | ${gi.goal.goalSetId.slice(0, 7)}${channelLink}`,
            });
        await gi.context.messageClient.addressUsers(msg, gi.goal.approval.userId, { id: msgId });
        return {
            vote: GoalApprovalRequestVote.Abstain,
        };
    });

    sdm.addCommand(ApprovalCommand)
        .addCommand(CancelApprovalCommand);

    return sdm;
}
