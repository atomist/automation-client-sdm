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
    LocalProject,
    projectUtils,
} from "@atomist/automation-client";
import { CodeTransform } from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";

/**
 * CodeTransform to prepare a project to package TS files in the final NPM archive.
 */
export const SourcesTransform: CodeTransform = async (p, papi) => {
    const cwd = (p as LocalProject).baseDir;

    const files = (await projectUtils.gatherFromFiles(p, ["**/*.ts"], async f => f)).filter(f => !f.path.endsWith(".d.ts"));
    if (files.length > 0) {
        await fs.ensureDir(path.join(cwd, "src"));
        for (const file of files) {
            await fs.move(path.join(cwd, file.path), path.join(cwd, "src", file.path));
            const base = file.path.slice(0, -3);
            const tsMap = path.join(cwd, `${base}.d.ts.map`);
            const jsMap = path.join(cwd, `${base}.js.map`);

            const segments = `..${path.sep}`.repeat(file.path.split("/").length - 1);

            if (await fs.pathExists(tsMap)) {
                const content = (await fs.readFile(tsMap)).toString();
                const newContent = content.replace(
                    /("sources":\[.*?\])/g,
                    `"sources":["${segments}src${path.sep}${file.path}"]`);
                await fs.writeFile(tsMap, newContent);
            }

            if (await fs.pathExists(jsMap)) {
                const content = (await fs.readFile(jsMap)).toString();
                const newContent = content.replace(
                    /("sources":\[.*?\])/g,
                    `"sources":["${segments}src${path.sep}${file.path}"]`);
                await fs.writeFile(tsMap, newContent);
            }
        }
    }
};