import * as fs from 'fs';
import * as process from 'process';
import * as stream from 'stream';

import * as S from './schema';
import { ArrayStream } from './io';
import { Decoder } from './decode_binast';
import { FixedSizeBufStream, StringTable, Encoder } from './encode_binast';
import { Importer, StringRegistry } from './parse_js';
import { parseScript } from 'shift-parser';

interface EncodeOptions {
    dumpAst: boolean;
}

function encode(inputFilename: string, outputFilename: string, options: EncodeOptions) {
    const data: string = fs.readFileSync(inputFilename, 'utf8');
    const json: any = parseScript(data);
    if (json.type !== 'Script') {
        throw new Error('Not a script');
    }
    const importer: Importer = new Importer();
    const script: S.Script = importer.liftScript(json);
    if (options.dumpAst) {
        console.log(JSON.stringify(script, null, 2));
    }

    const sr: StringRegistry = importer.strings;
    const stringTable = new StringTable(sr.stringsInLexicographicOrder());
    const writeStream = new FixedSizeBufStream();
    const encoder = new Encoder({ script, stringTable, writeStream });
    encoder.encode();

    const outputWriter: stream.Writable = fs.createWriteStream(outputFilename);
    writeStream.copyToWritable(outputWriter);
    outputWriter.end();
}

function decode(filename: string) {
    const buffer: Buffer = fs.readFileSync(filename);
    const decoder = new Decoder(new ArrayStream(buffer));
    decoder.decode();
    console.log(JSON.stringify(decoder.script, null, 2));
}

function main() {
    const args: Array<string> = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Filename not given.");
        process.exit(1);
    }
    if (args[0] === '--encode') {
        const input_filename = args[1];
        const output_filename = input_filename + '.binjs';
        encode(input_filename, output_filename, {
            dumpAst: args.indexOf('--dump-ast') !== -1,
        });
    } else if (args[0] == '--decode') {
        decode(args[1]);
    } else {
        console.error(`Unrecognized command: ${args[0]}`);
        process.exit(1);
    }
}

main();
