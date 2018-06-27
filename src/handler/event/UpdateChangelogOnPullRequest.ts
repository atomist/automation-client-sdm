/*
 * Copyright © 2018 Atomist, Inc.
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
    EventFired,
    EventHandler,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    Value,
} from "@atomist/automation-client";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import { addChangelogEntryForClosedIssue } from "../../editing/changelog/changelog";
import {
    ClosedIssueWithChangelog,
    ClosedPullRequestWithChangelog,
} from "../../typings/types";

@EventHandler("Update CHANGELOG.md on a closed pull request",
    subscription("closedPullRequestWithChangelogLabel"))
export class UpdateChangelogOnPullRequest implements HandleEvent<ClosedPullRequestWithChangelog.Subscription> {

    @Value("token")
    public orgToken: string;

    public handle(e: EventFired<ClosedPullRequestWithChangelog.Subscription>,
                  ctx: HandlerContext): Promise<HandlerResult> {
        return addChangelogEntryForClosedIssue(e.data.PullRequest[0] as any as ClosedIssueWithChangelog.Issue, this.orgToken);
    }
}
