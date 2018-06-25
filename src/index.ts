
import * as process from 'process';
import * as fs from 'fs';
import * as assert from 'assert';

import {parseScript} from 'shift-parser';
import * as S from './schema';
import {Importer, Registry} from './parse_js';
import {ArrayWriteStream, Table, Encoder}
            from './encode_binast';

function encode(filename: string, outdir: string) {
    // Read and parse the script into Shift json.
    const data: string = fs.readFileSync(filename, "utf8");
    const json: any = parseScript(data);
    if (json.type !== 'Script') {
        throw new Error('Not a script');
    }

    // Create importer and lift script into typed schema.
    const importer: Importer = new Importer();
    const script: S.Script = importer.liftScript(json);

    console.debug("DONE LIFTING");

    // Create the string table.
    const sr: Registry<string> = importer.strings;
    const strings = sr.inFrequencyOrder();
    const stringTable = new Table<string>(strings);

    // Create the node kinds table.
    const nr: Registry<object|string> = importer.nodes;
    const nodes: Array<object|string> = nr.inFrequencyOrder();
    const staticTypes = ['string', 'uint', 'number', 'boolean', 'null',
                         'scope'];
    nodes.splice(0, 0, ...staticTypes);
    const nodeKindTable = new Table<object|string>(nodes);

    const encoder = new Encoder({stringTable,
                                 nodeKindTable});

    const stringTableStream = new ArrayWriteStream();
    const stringTableEncLength = encoder.encodeStringTable(stringTableStream);
    assert.equal(stringTableEncLength, stringTableStream.array.length);

    const treeStream = new ArrayWriteStream();
    const treeEncLength = encoder.encodeScriptBin(script, treeStream);
    assert.equal(treeEncLength, treeStream.array.length);
    console.log(`Encoded string table with ${stringTable.size} entries: ` +
                `${stringTableEncLength}`);
    console.log(`Encoded tree: ${treeEncLength}`);


    //dumpByteArray(stringTableStream.array);
    //dumpByteArray(treeStream.array);
    const origCopyFile = outdir + '/original.js';
    const stringTableFile = outdir + '/section-01-string-table';
    const treeFile = outdir + '/section-02-tree';
    const fullFile = outdir + '/full.binast';

    const origData = fs.readFileSync(filename);
    dumpFile(origData, origCopyFile);
    dumpFile(stringTableStream.array, stringTableFile);
    dumpFile(treeStream.array, treeFile);
    dumpFile(stringTableStream.array.concat(treeStream.array), fullFile);
}

function dumpFile(arr, fileName) {
    const byteArray = new Uint8Array(arr);
    fs.writeFileSync(fileName, byteArray);
}

function dumpByteArray(arr) {
    for (let i = 0; i < arr.length; i += 16) {
        const line = [`${i}: `];
        for (let j = i; j < i + 16; j++) {
            if (j >= arr.length) { break; }
            const b = arr[j];
            assert(Number.isInteger(b) && (0 <= b) && (b <= 0xff));
            let s = b.toString(16);
            assert(s.length > 0 && s.length <= 2);
            if (s.length == 1) {
                s = '0' + s;
            }
            line.push(`${s} `);
        }
        console.log(line.join(''));
    }
}

function errExit(msg) {
    console.error(msg);
    process.exit(1);
}

function main() {
    const args: Array<string> = process.argv.slice(2);
    if (args[0] === '--encode') {
        if (args.length == 1) {
            errExit('Filename not given');
        }
        if (args.length == 2) {
            errExit('Output directory not given');
        }
        const filename = args[1];
        const outdir = args[2];

        if (!fs.statSync(outdir).isDirectory()) {
            errExit(`Outdir ${outdir} is not a directory!`);
        }
        console.log(`ENCODING: ${filename} into ${outdir}`);
        encode(filename, outdir);
    } else {
        errExit(`Unrecognized command: ${args[0]}`);
    }
}

main();
