
import * as process from 'process';
import * as fs from 'fs';

import {parseScript} from 'shift-parser';
import * as S from './schema';
import {Importer, Registry} from './parse_js';
import {FixedSizeBufStream, Table, Encoder} from './encode_binast';

function encode(filename: string) {
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
    const staticTypes = ['string', 'integer', 'boolean', 'null'];
    nodes.splice(0, 0, ...staticTypes);
    const nodeKindTable = new Table<object|string>(nodes);

    const writeStream = new FixedSizeBufStream();
    const encoder = new Encoder({script,
                                 stringTable,
                                 nodeKindTable,
                                 writeStream});

    const stSize = encoder.encodeStringTable();
    console.log(`Encoded string table size=${stSize}`);
    let stLength = 0;
    strings.forEach((s, i) => {
        const f = sr.frequencyOf(s);
        console.log(`String [${i}] \`${s}\` - ${f}`);
    });

    console.log(`----`);
    console.log(`Grammar nodes used=${nodes.length}`);
    nodes.forEach((n, i) => {
        if (typeof(n) === 'string') {
            console.log(`Primitive [${i}] \`${n}\``);
        } else {
            const f = nr.frequencyOf(n);
            console.log(`Node [${i}] \`${n['name']}\` - ${f}`);
        }
    });

    encoder.encodeScript(script);
    /*
    // console.log(JSON.stringify(script, null, 2));
    */
}

function main() {
    const args: Array<string> = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Filename not given.");
        process.exit(1);
    }
    if (args[0] === '--encode') {
        console.log(`ENCODING: ${args[1]}`);
        encode(args[1]);
    } else {
        console.error(`Unrecognized command: ${args[0]}`);
        process.exit(1);
    }
}

main();
