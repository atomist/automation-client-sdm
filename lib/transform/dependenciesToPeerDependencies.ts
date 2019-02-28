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

import { CodeTransform } from "@atomist/sdm";
import * as _ from "lodash";
import * as semver from "semver";

/**
 * Rewrite direct package dependencies to peerDependencies to allow easier consumption via
 * npm dependencies.
 * @param toRewrite
 */
export function dependenciesToPeerDependenciesTransform(...toRewrite: RegExp[]): CodeTransform {
    return async p => {
        const pjFile = await p.getFile("package.json");
        const pj = JSON.parse(await pjFile.getContent());

        toRewrite.forEach(r => r.global === true);

        _.forEach(pj.dependencies || {}, (version, name) => {
            if (toRewrite.some(r => r.test(name))) {
                const semVersion = `>=${semver.major(version)}.${semver.minor(version)}.0`;
                pj.peerDependencies[name] = semVersion;
                delete pj.dependencies[name];
            }
        });

        await pjFile.setContent(JSON.stringify(pj, undefined, 2));

        return p;
    };
}
