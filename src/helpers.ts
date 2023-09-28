// @ts-check

/*
 * SPDX-License-Identifier: BSD-3-Clause
 * SPDX-FileCopyrightText: Copyright (c) 2023, TF-RMM Contributors.
 */

import path from 'path';
import fs from 'fs';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { PackageURL } from 'packageurl-js';
import {
  PackageCache
} from '@github/dependency-submission-toolkit';

/* Type definition for a Git Submodule. */
export type Submodule = {
    name: string;
    path: string;
    url: string;
    tag: string;
};

/*
 * This function receives the path to a git submodule (relative to the root
 * of the repository) and returns the closest tag and sha currently in use.
 */
export async function processSubmoduleTag(modulePath: string): Promise<string>
{
    const submodulePath = path.normalize(modulePath);
    console.log(`Trying to get TAG/SHA for ${submodulePath}`);

    /* Try to get the closest tag, with additional commits on top of it */
    var tag = await exec.getExecOutput(
        'git',
        ['describe', '--tags'],
        { cwd: submodulePath}
    );

    if (tag.exitCode !== 0) {
        /* No available tag. Try with the SHA */
        tag = await exec.getExecOutput(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd: submodulePath}
        );

        if (tag.exitCode !== 0) {
            /* Report the error and exit */
            core.error(tag.stderr);
            core.setFailed("'git' failed!");
            throw new Error('Failed to execute git');
        }
    }

    console.log(`Detected TAG/SHA ${tag.stdout} for ${submodulePath}`);

    return Promise.resolve(tag.stdout);
}

/*
 * This function receives a Submodule object and generates a
 * Package-URL (PURL) object in return.
 */
export function processSubmodule(submodule: Submodule): PackageURL
{
    if (submodule.name == '' || submodule.path == '' ||
        submodule.url == '' || submodule.tag == '') {

        /* Incomplete submodule structure */
        core.error('Incomplete Submodule');
        core.setFailed('processSubmodule() failed!');
        throw new Error('Incomplete Submodule detected');
    }

    const type = submodule.url.split('/')[2];
    const namespace = submodule.url.split('/')[3];
    const name = submodule.url.split('/')[4].split('.')[0];

    if (type !== 'github.com') {

        /* Only github.com repositories supported as type */
        core.error('Unsupported submodule type: ${type}');
        core.setFailed('processSubmodule() failed!');
        throw new Error(`${type} submodule type not supported`);
    }

    /* Generate and return the PackageURL */
    return new PackageURL(type.split('.')[0], namespace, name,
                          submodule.tag, null, null);
};

/*
 * Function go generate an array of PURLs given an array of Submodule objects
 */
export function processSubmoduleUrls(submodules : Array<Submodule>):
                                                    Array<PackageURL>
{
    const purls : Array<PackageURL> = [];

    submodules.forEach((submodule) => {
        purls.push(processSubmodule(submodule));
    });

    return purls;
}

/*
 * Function to generate a PackageCache object from an array of Submodule objects
 */
export function processSubmoduleCache(submodules: Array<Submodule>): PackageCache
{
    const cache = new PackageCache();

    submodules.forEach((submodule) => {
        cache.package(processSubmodule(submodule));
    });

    return cache;
}

/*
 * Receives a manifest file (.gitmodules) and extract the relevant
 * information for each submodule.
 */
export async function parseSubmoduleManifest(manifest: string):
                                                Promise<Array<Submodule>>
{
    console.log(`Processing manifest file ${manifest}`)

    var submodules: Array<Submodule> = [];
    var submodule : Submodule = {
        name: '',
        path: '',
        url: '',
        tag: ''
    };

    const manifestPath = path.normalize(manifest);

    if (path.basename(manifestPath) !== '.gitmodules' ||
                                    !fs.existsSync(manifestPath)) {
        throw new Error(`${manifestPath} is not a .gitmodules file or it does not exist!`)
    }

    const manifestFile : string = fs.readFileSync(manifestPath, 'utf8');

    /*
     * Process the manifest file line by line.
     * For simplicity, assume that all the submodule entries have at least
     * a path and a url.
     */
    const manifestLines = manifestFile.split('\n');
    for(let i = 0; i < manifestLines.length; i++) {
        let line = manifestLines[i];

        if (submodule.name === '' && line.includes('submodule "')) {
            /* Beginning of a submodule section */
            submodule.name = line.split('"')[1];
            console.log (`Detected submodule "${submodule.name}"`);
        } else if (submodule.path === '' && line.includes('path =')) {
            /* Detected path section */
            submodule.path = line.split('=')[1].trim();
        } else if (submodule.url === '' && line.includes('url =')) {
            /* Detected URL sectin */
            submodule.url = line.split('=')[1].trim();
        }

        /* Verify if we have all the information we need */
        if (submodule.name !== '' && submodule.path !== '' &&
                                                    submodule.url !== '') {
            submodules.push(submodule);
            /* Reset the submodule info so to carry on with the next one*/
            submodule = {
                name: '',
                path: '',
                url: '',
                tag: ''
            }
        }
    }

    /* Retrievve the tag information for all the modules */
    const tags : Array<string> =
            await Promise.all(submodules.map(submodule =>
                                        processSubmoduleTag(submodule.path)));

    /* Add the tag information to the existing submodules */
    tags.forEach((tag, index) => {
        submodules[index].tag = tag;
    });

    return submodules
}