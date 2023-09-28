// @ts-check

/*
 * SPDX-License-Identifier: BSD-3-Clause
 * SPDX-FileCopyrightText: Copyright (c) 2023, TF-RMM Contributors.
*/

import path from 'path';
import * as core from '@actions/core';
import {
Snapshot,
    Manifest,
    submitSnapshot
} from '@github/dependency-submission-toolkit';

import {
    processSubmoduleCache,
    processSubmoduleUrls,
    parseSubmoduleManifest
} from './helpers';

const version = require('../package.json')['version']

type DependencyScope = 'runtime' | 'development';

async function main () {
    const manifestPath = core.getInput('manifest', {required: false});
    const submoduleList = await parseSubmoduleManifest(manifestPath);
    const purls = processSubmoduleUrls(submoduleList);
    const modulesCache = processSubmoduleCache(submoduleList);
    const developmentDeps = core.getInput('development-deps', {required: false});
    const manifest = new Manifest(path.basename(manifestPath), manifestPath);

    purls.forEach((purl) => {

        /* Verify that the PURL exists in the cache */
        const dep = modulesCache.lookupPackage(purl);
        if (!dep) {
            throw new Error(
                'assertion failed: expected all direct dependencies to have entries in the module cache'
            );
        }

        /* Find out whether the dependency is a runtime or development one */
        let scope : DependencyScope = 'runtime';
        if (developmentDeps.includes(dep.name())) {
            scope = 'development';
        }

        /* Add the dependency to the manifest */
        manifest.addDirectDependency(dep, scope);
    })

    const snapshot = new Snapshot(
    {
        name: 'TF-RMM/git-submodule-dependency-submission',
        url: 'https://github.com/TF-RMM/arm-git-submodule-dependency-submission',
        version: version
    });

    snapshot.addManifest(manifest);
    submitSnapshot(snapshot);
}

main();