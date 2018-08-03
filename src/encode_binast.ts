
import * as assert from 'assert';

import * as S from './schema';
import * as util from './util';
import {buildPrefixCuts} from './tree_template';

import {WriteStream, ArrayWriteStream, EncodingWriter, Table}
    from './write_stream';

import {RangeCoder} from './range_coder';

export const MAGIC_STRING: string = 'BINJS';
export const FORMAT_VERSION: number = 0;

export const HEADER_STRINGS_TABLE: string = '[STRINGS]';
export const HEADER_GRAMMAR_TABLE: string = '[GRAMMAR]';
export const HEADER_TREE: string = '[TREE]';

export class PathEntry {
    readonly parent: S.BaseNode;
    readonly sep: string;
    readonly name: string;

    constructor(parent: S.BaseNode, sep: string, name: string) {
        this.parent = parent;
        this.sep = sep;
        this.name = name;
    }

    toString(): string {
        return `${this.parent.nodeKindName}${this.sep}${this.name}`;
    }
}

export class ProbEntry {
    readonly value: any;
    readonly offset: number;
    readonly count: number;
    readonly total: number;

    constructor(value: any, offset: number, count: number, total: number) {
        this.value = value;
        this.offset = offset;
        this.count = count;
        this.total = total;
        Object.freeze(this);
    }

    toString() {
        let {value, offset, count, total} = this;
        let pct = (((count / total) * 10000)|0) / 100;
        return `ProbEntry(${value}, ${pct}%, of=${total})`;
    }

    encodeInto(rangeCoder) {
        rangeCoder.encodeFreq(this.count, this.offset, this.total);
    }
}

// Sentinel object to represent unknown-symbol key.
const UNK_SYM = Object.freeze({toString() { return "<<<UNK_SYM>>>"; }});

export class ProbMap {
    readonly sum: number;
    readonly map: Map<any, ProbEntry>;

    constructor(sum: number, map: Map<any, ProbEntry>) {
        this.sum = sum;
        this.map = map;
    }

    has(value: any): boolean {
        return this.map.has(value);
    }
    get(value: any): ProbEntry {
        return this.map.get(value);
    }
}

export function makeProbMap(key: string,
                            map: Map<any, number>,
                            entries: number)
  : ProbMap
{
    let total: number = 0;
    map.forEach((count: number, val: any) => {
        total += count;
    });

    // Sort most probable entries first.
    const arr = Array.from(map.entries()).sort((a, b) => (b[1] - a[1]));

    let highProbEntries: number = Math.min(entries, arr.length);
    let lowProbEntries: number = arr.length - highProbEntries;

    let highProbCount: number = 0;
    for (let i = 0; i < highProbEntries; i++) {
        const count = arr[i][1];
        assert(Number.isInteger(count) && count > 0);
        highProbCount += count;
    }

    let lowProbCount: number = 0;
    for (let i = highProbEntries; i < arr.length; i++) {
        let count = arr[i][1];
        lowProbCount += count;
    }
    let totalCount: number = highProbCount + lowProbCount;

    // Don't allow for a very low lowProbCount.
    if (lowProbCount <= (highProbCount >> 12)) {
        if (highProbCount < 4096) {
            totalCount += 1;
            lowProbCount = 1;
        } else {
            totalCount += highProbCount >> 12;
            lowProbCount = highProbCount >> 12;
        }
    }

    const result: Map<any, ProbEntry> = new Map();
    let curOffset: number = 0;
    for (let i = 0; i < highProbEntries; i++) {
        let [val, count] = arr[i];
        assert(Number.isInteger(count) && count > 0);
        result.set(val, new ProbEntry(val, curOffset, count as number,
                                      totalCount));
        curOffset += count as number;
    }
    assert(curOffset == highProbCount);

    // Assign remaining probability to 
    result.set(UNK_SYM, new ProbEntry(UNK_SYM, highProbCount, lowProbCount,
                                      totalCount));

    console.log(`>>>> PROB-Map ${totalCount}   ${key}`);
    result.forEach((pe: ProbEntry, v: any) => {
        console.log(`    >> ENT ${v} => ${pe}`);
    });
    return new ProbMap(totalCount, result);
}

enum EncoderMode { CollectFreqs, UseProbs };

export class Encoder {
    readonly stringTable: Table<string>;
    readonly nodeKindTable: Table<string>;

    readonly collectFreqs: boolean;
    readonly freqMap: Map<string, Map<any, number>>;

    readonly useProbs: boolean;
    readonly probMaps: Map<string, ProbMap>;

    readonly predictions: Map<string, Array<any>>;
    readonly curPath: Array<PathEntry>;
    readonly rangeCoder;
    readonly compressedBytes: Array<number>;
    tabbing: number;

    constructor(params: {stringTable: Table<string>,
                         nodeKindTable: Table<string>,
                         probMaps?: Map<string, ProbMap>})
    {
        this.stringTable = params.stringTable;
        this.nodeKindTable = params.nodeKindTable;

        this.collectFreqs = true;
        this.freqMap = new Map();

        this.useProbs = !!params.probMaps;
        this.probMaps = params.probMaps || new Map();
            
        this.predictions = new Map();
        
        this.curPath = [];
        this.tabbing = 0;

        const compressedBytes = [];
        this.compressedBytes = compressedBytes;
        const stream = {
            writeByte(b) {
                let bstr = b.toString(16);
                assert(bstr.length == 1 || bstr.length == 2);
                console.log(`WRITE COMPRESSED BYTE: ${b.toString(16)}`);
                compressedBytes.push(b);
            }
        }
        this.rangeCoder = new RangeCoder(stream);
    }

    getCompressedBytes(): Array<number> {
        this.rangeCoder.encodeFinish();
        return this.compressedBytes;
    }

    checkFreqPrediction(predictor: string, value: any): number {
        if (!this.freqMap.has(predictor)) { return 0; }
        const pred = this.freqMap.get(predictor);
        if (!pred.has(value)) { return 0; }
        const count: number = pred.get(value);
        let total: number = 0;
        for (let p of pred.values()) {
            total += p;
        }
        return count / total;
    }

    checkProbPrediction(predictor: string, value: any): ProbEntry|null {
        // If no predictor information exists, both encoder and
        // decoder will give the entire space to UNK_SYM (i.e.
        // UNK_SYM is assumed).
        if (!this.probMaps.has(predictor)) { return null; }

        // If an entry exists for the value, use it.
        const pred = this.probMaps.get(predictor);
        if (pred.has(value)) {
            return pred.get(value);
        }

        // Otherwise, return the UNK_SYM prob
        return pred.get(UNK_SYM);
    }

    registerProb(predictor: string, value: any) {
        const preds = this.predictions.get(predictor);
        const pr = this.checkFreqPrediction(predictor, value);
        if (preds) {
            preds.push([pr, value]);
        } else {
            this.predictions.set(predictor, [[pr, value]]);
        }

        if (this.collectFreqs) {
            if (!this.freqMap.has(predictor)) {
                this.freqMap.set(predictor, new Map<any, number>());
            }
            const pred = this.freqMap.get(predictor);
            if (pred.has(value)) {
                pred.set(value, pred.get(value) + 1);
            } else {
                pred.set(value, 1);
            }
        }
    }
    makePredictors(extra?: string): Array<string> {
        extra = extra ? "@" + extra : "";
        const preds: Array<string> = [];
        const curPath = this.curPath;
        if (curPath.length == 0) {
            return ['--'];
        }
        const results = new Array<string>();
        const p1 = `${curPath[curPath.length - 1]}${extra}`;
        results.push(`-- ${p1}`);
        if (this.curPath.length == 1) {
            return results;
        }

        const p2 = `${this.curPath[this.curPath.length - 2]}${extra}`;
        results.push(`-- ${p1} -- ${p2}`);
        return results;
    }

    registerChildType(childTypeName: string) {
        for (let pred of this.makePredictors()) {
            this.registerProb(pred, childTypeName);
        }
    }
    registerFieldSpecial(special: string, value: any) {
        for (let pred of this.makePredictors(special)) {
            this.registerProb(pred, value);
        }
    }
    registerFieldType(fieldTypeName: string) {
        for (let pred of this.makePredictors()) {
            this.registerProb(pred, fieldTypeName);
        }
    }
    registerFieldValue(fieldTypeName: string, fieldValue: any) {
        for (let pred of this.makePredictors(fieldTypeName)) {
            this.registerProb(pred, fieldValue);
        }
    }

    predChildType(childTypeName: string): ProbEntry|null {
        for (let pred of this.makePredictors()) {
            let probEnt = this.checkProbPrediction(pred, childTypeName);
            if (probEnt !== null) {
                return probEnt;
            }
        }
        return null;
    }
    predFieldSpecial(special: string, value: any): ProbEntry|null {
        for (let pred of this.makePredictors(special)) {
            let probEnt = this.checkProbPrediction(pred, value);
            if (probEnt !== null) {
                return probEnt;
            }
        }
        return null;
    }
    predFieldType(fieldTypeName: string): ProbEntry|null {
        for (let pred of this.makePredictors()) {
            let probEnt = this.checkProbPrediction(pred, fieldTypeName);
            if (probEnt !== null) {
                return probEnt;
            }
        }
        return null;
    }
    predFieldValue(fieldTypeName: string, fieldValue: any): ProbEntry|null {
        for (let pred of this.makePredictors(fieldTypeName)) {
            let probEnt = this.checkProbPrediction(pred, fieldValue);
            if (probEnt !== null) {
                return probEnt;
            }
        }
        return null;
    }

    emitDirectCodedVarUint(n: number) {
        const bytes = util.uintToVarUintBytes(n);
        for (let b of bytes) {
            this.rangeCoder.encodeByte(b);
        }
    }

    emitPredictedChildType(pred: ProbEntry, ty: number) {
        // TODO: This limits types to 256 variants.  Eventually
        // we want to encode this as VarUint and predict each
        // byte individually (2 bytes in varuint = 14 bits =
        // 16k types, so it'll be a while before we need to
        // use more than 2 bytes).
        assert(util.isByte(ty));

        if (pred === null) {
            // No prediction data available.
            console.log(`ZOOZ - emitPredictedChildType(DIRECT=${ty})`);
            this.rangeCoder.encodeByte(ty);
            return;
        }

        if (pred.value === UNK_SYM) {
            // Emit unknown symbol
            console.log(`ZOOZ - emitPredictedChildType(UNK=${pred}, ${ty})`);
            pred.encodeInto(this.rangeCoder);
            this.rangeCoder.encodeByte(ty);
            return;
        }

        assert(this.absoluteTypeIndex(pred.value) === ty);
        console.log(`ZOOZ - emitPredictedChildType(${pred})`)
        pred.encodeInto(this.rangeCoder);
    }
    emitPredictedEncodedLength(len: number) {
        console.log(`ZOOZ - emitPredictedEncodedLength(PRED=${len})`);
        this.emitDirectCodedVarUint(len);
    }
    emitPredictedArrayLength(pred: ProbEntry, len: number) {
        if (pred === null) {
            // No prediction data available.
            console.log(`ZOOZ - emitPredictedArrayLength(DIRECT=${len})`);
            this.emitDirectCodedVarUint(len);
            return;
        }
        if (pred.value === UNK_SYM) {
            // Emit unknown symbol
            console.log(`ZOOZ - emitPredictedArrayLength(UNK=${pred}, ${len})`);
            pred.encodeInto(this.rangeCoder);
            this.rangeCoder.encodeVarUint(len);
            return;
        }
        assert(pred.value === len);
        console.log(`ZOOZ - emitPredictedArrayLength(PRED=${pred})`)
        pred.encodeInto(this.rangeCoder);
    }
    emitPredictedFieldType(pred: ProbEntry, ty: number) {
        assert(util.isByte(ty));

        if (pred === null) {
            // No prediction data available.
            console.log(`ZOOZ - emitPredictedFieldType(DIRECT=${ty})`);
            this.rangeCoder.encodeByte(ty);
            return;
        }
        if (pred.value === UNK_SYM) {
            // Emit unknown symbol
            console.log(`ZOOZ - emitPredictedFieldType(UNK=${pred}, ${ty})`);
            pred.encodeInto(this.rangeCoder);
            this.rangeCoder.encodeByte(ty);
            return;
        }
        assert(this.absoluteTypeIndex(pred.value) === ty);
        console.log(`ZOOZ - emitPredictedFieldType(${pred})`)
        pred.encodeInto(this.rangeCoder);
    }
    emitDirectCodedFieldValue(typeName: string, val: any) {
        switch (typeName) {
          case 'string':
            this.emitDirectCodedVarUint(val);
            return;
          case 'boolean':
            assert(typeof(val) === 'boolean');
            this.rangeCoder.encodeBit(val ? 1 : 0);
            return;
          case 'uint':
            this.emitDirectCodedVarUint(val);
            return;
          case 'byte':
            this.rangeCoder.encodeByte(val);
            return;
          default:
            throw new Error(`Unknown field type ${typeName} for '${val}'`);
        }
    }
    emitPredictedFieldValue(pred: ProbEntry, typeName: string, val: any) {
        if (pred === null) {
            // No prediction data available.
            console.log(`ZOOZ - emitPredictedFieldValue(DIRECT=` +
                        `${val}:${typeName})`);
            this.emitDirectCodedFieldValue(typeName, val);
            return;
        }
        if (pred.value === UNK_SYM) {
            // Emit unknown symbol
            console.log(`ZOOZ - emitPredictedFieldValue(UNK=${pred},` +
                        ` ${val},${typeName})`);
            pred.encodeInto(this.rangeCoder);
            this.emitDirectCodedFieldValue(typeName, val);
            return;
        }
        assert(pred.value === val);
        console.log(`ZOOZ - emitPredictedFieldValue(${pred}, ${typeName})`)
        pred.encodeInto(this.rangeCoder);
    }

    encodeStringTable(ws: WriteStream): number {
        const w = new EncodingWriter(ws);
        let written = 0;
        this.stringTable.each((s: string) => {
            written += w.writeInlineString(s);
        });
        return written;
    }

    dumpScriptText(script: S.Script) {
        this.tabbing = 0;
        this.dumpSubtreeText(script);
    }
    encodeScript(script: S.Script, ws: WriteStream): number {
        // TODO: The general strategy seems to be pull the last
        // byte from the compressed sequence and pass it for the
        // first raw-encoded byte.  I don't know why this exists
        // really, but for now I'll just waste it by using a const
        // 0 byte.
        this.rangeCoder.encodeStart(/* byte = */ 0, 1);

        assert(this.curPath.length == 0);
        return this.encodeNodeSubtree(script, new EncodingWriter(ws));
    }

    absoluteTypeIndex(ty: string) {
        return this.nodeKindTable.index(ty);
    }
    absoluteStringIndex(str: string) {
        return this.stringTable.index(str);
    }

    logTabbed(s) {
        console.log(('   ').repeat(this.tabbing) + s);
    }
    dumpSubtreeText(node: S.BaseNode|null) {
        if (node !== null && !(node instanceof S.BaseNode)) {
            console.log("GOT BAD NODE: " + JSON.stringify(node));
            throw new Error("ERROR");
        }
        assert(!Array.isArray(node));

        const self = this;

        if (node === null) {
            self.logTabbed("NULL");
            return;
        }

        // Look up the node constructor's index.
        const kind = node.constructor;
        self.logTabbed(`<Node ${kind.name}> ||-`);
        node.constructor['scan']({
            child(name: string, opts?: {skippable?: boolean}) {
                // console.log(`CHILD[${kind.name}] = ${name}`);
                if (opts && opts.skippable) {
                    self.logTabbed(`  [Skippable] ${name} -`);
                } else {
                    self.logTabbed(`  ${name}:`);
                }
                self.tabbing++;
                self.dumpSubtreeText(node[name] as (S.BaseNode|null));
                self.tabbing--;
            },
            childArray(name: string) {
                // console.log(`ARRAY_CHILD[${kind.name}] = ${name}`);
                self.logTabbed(`  Array<${name}>:`);
                assert(Array.isArray(node[name]));
                self.tabbing++;
                for (let childNode of node[name]) {
                    self.dumpSubtreeText(childNode as (S.BaseNode|null));
                }
                self.tabbing--;
            },
            field(name: string) {
                // TODO: Show types for text-dumped fields
                // TODO: Dump full contents of scope-typed values.
                self.logTabbed(`  Field.${name} = ${node[name]}`);
            }
        });
    }

    encodeNodeSubtree(node: S.BaseNode|null, w: EncodingWriter): number {
        if (node !== null && !(node instanceof S.BaseNode)) {
            console.log("GOT BAD NODE: " + JSON.stringify(node));
            throw new Error("ERROR");
        }
        assert(!Array.isArray(node));

        const self = this;

        if (node === null) {
            // Encode a null.
            const nullIdx = self.absoluteTypeIndex('null');
            return w.writeVarUint(nullIdx);

            // Encode a compressed null.
            if (this.useProbs) {
                let pred = self.predChildType('null');
                this.emitPredictedChildType(pred, nullIdx);
            }
            self.registerChildType('null');
        }

        let written = 0;

        // Look up the node constructor's index.
        const kind: string = node.nodeKindName;
        const idx = self.absoluteTypeIndex(kind);

        // Write out the type of the node.
        written += w.writeVarUint(idx);

        // Encode a compressed kind.
        if (self.useProbs) {
            let pred = self.predChildType(kind);
            this.emitPredictedChildType(pred, idx);
        }
        self.registerChildType(kind);

        const childArrays: Map<string, Array<S.BaseNode>> = new Map();

        // Encode each child and field in order.
        node.constructor['scan']({
            child(name: string, opts?: {skippable?: boolean}) {
                const childNode = node[name] as (S.BaseNode|null);

                self.curPath.push(new PathEntry(node, '::', name));
                self.registerChildType((childNode === null)
                                            ? 'null'
                                            : childNode.nodeKindName);

                if (opts && opts.skippable) {
                    // Encode child into a separate tream, compute
                    // its length, and add it.
                    const stream = new ArrayWriteStream();
                    const w2 = new EncodingWriter(stream);
                    const stBytes = self.encodeNodeSubtree(childNode, w2);
                    assert(stBytes > 0);
                    assert(stBytes === stream.array.length);
                    written += w.writeVarUint(stBytes);

                    // The decoder is expecting the encoded length here.
                    // Realistically, we need to update the predictor here
                    // with the length, but we won't know it until after
                    // we encode the inner function stream.  The inner
                    // function stream's compression may add its own
                    // inner functions, and ifluence the frequency
                    // counts.
                    //
                    // Here, we just avoid the issue by always emitting
                    // encodedLength prefixes as raw varuints.
                    //
                    // FIXME: We actually need to save the compressed
                    // data to a bitstream, get the length, and then
                    // encode that length here.  For now, use
                    // the long-form encoded-length as a size-equivalent
                    // substituate.  (The fact that it comes after the
                    // function bits will not affect the final size).
                    if (self.useProbs) {
                        self.emitPredictedEncodedLength(stBytes);
                    }

                    written += w.writeArray(stream.array);
                } else {
                    written += self.encodeNodeSubtree(childNode, w);
                }

                self.curPath.pop();
            },
            childArray(name: string) {
                assert(Array.isArray(node[name]));
                const childNodes: Array<S.BaseNode> =
                    node[name] as Array<S.BaseNode>;
                assert(childNodes.every(n => (n instanceof S.BaseNode)));
                childArrays.set(name, childNodes);

                const len = childNodes.length;
                written += w.writeVarUint(len);

                if (self.useProbs) {
                    const pred = self.predFieldSpecial('length', len);
                    self.emitPredictedArrayLength(pred, len);
                }
                self.registerFieldSpecial('length', len);

                self.curPath.push(new PathEntry(node, '::', name + '[]'));

                for (let childNode of node[name]) {
                    written += self.encodeNodeSubtree(childNode, w);
                }

                self.curPath.pop();
            },
            field(name: string, ty?:S.FieldType|null) {
                self.curPath.push(new PathEntry(node, '.', name));
                written += self.encodeFieldValue(node, name, node[name], w);
                self.curPath.pop();
            }
        });

        if (childArrays.size > 0) {
            console.log(`PARENT ${kind}`);
            for (let name of childArrays.keys()) {
                const arr = childArrays.get(name);
                if (arr.length > 0) {
                    console.log(`  ${name} [${arr.length}] => ` +
                                arr.map(n => n.nodeKindName).join(','));
                }
                let cutList = buildPrefixCuts(arr);
                console.log(`  CUTS: ${cutList.length > 1 ? " MULTI " : ""}${cutList.join(',')}`);
            }
        }

        return written;
    }

    encodeFieldValue(parentNode: S.BaseNode, name: string, val: any, w: EncodingWriter): number {
        const parentKind = parentNode.nodeKindName;
        const ty = typeof(val);
        let written = 0;
        switch (ty) {
          case 'object': {
            if (val === null) {
                // Encode a null.
                const nullIdx = this.absoluteTypeIndex('null');
                written += w.writeVarUint(nullIdx);
                if (this.useProbs) {
                    const pred = this.predFieldType('null');
                    this.emitPredictedFieldType(pred, nullIdx);
                }
                this.registerFieldType('null');
            } else if (val instanceof S.AssertedVarScope) {
                written += this.encodeVarScopeField(
                                val as S.AssertedVarScope, w);
            } else if (val instanceof S.AssertedBlockScope) {
                written += this.encodeBlockScopeField(
                                val as S.AssertedBlockScope, w);
            } else if (val instanceof S.AssertedParameterScope) {
                written += this.encodeParameterScopeField(
                                val as S.AssertedParameterScope, w);
            } else {
                throw new Error("Cannot encode field: " + val.constructor.name);
            }
            break;
          }
          case 'string': {
            const tyIdx = this.absoluteTypeIndex('string');
            if (this.useProbs) {
                const pred = this.predFieldType('string');
                this.emitPredictedFieldType(pred, tyIdx);
            }
            written += w.writeVarUint(tyIdx);
            this.registerFieldType('string');

            const strIdx = this.absoluteStringIndex(val as string);
            if (this.useProbs) {
                const pred = this.predFieldValue('string', strIdx);
                this.emitPredictedFieldValue(pred, 'string', strIdx);
            }
            written += w.writeVarUint(strIdx);
            this.registerFieldValue('string', strIdx);

            break;
          }
          case 'boolean': {
            const tyIdx = this.absoluteTypeIndex('boolean');
            if (this.useProbs) {
                const pred = this.predFieldType('boolean');
                this.emitPredictedFieldType(pred, tyIdx);
            }
            written += w.writeVarUint(tyIdx);
            this.registerFieldType('boolean');

            if (this.useProbs) {
                const pred = this.predFieldValue('boolean', val);
                this.emitPredictedFieldValue(pred, 'boolean', val);
            }
            written += w.writeByte(val ? 1 : 0);
            this.registerFieldValue('boolean', val);
            break;
          }
          case 'number': {
            if (Number.isInteger(val) &&
                ((val >= 0) && (val <= 0xffffffff)))
            {
                const tyIdx = this.absoluteTypeIndex('uint');
                if (this.useProbs) {
                    const pred = this.predFieldType('uint');
                    this.emitPredictedFieldType(pred, tyIdx);
                }
                written += w.writeVarUint(tyIdx);
                this.registerFieldType('uint');

                if (this.useProbs) {
                    const pred = this.predFieldValue('uint', val);
                    this.emitPredictedFieldValue(pred, 'uint', val);
                }
                written += w.writeVarUint(val);
                this.registerFieldValue('uint', val);
            } else {
                const tyIdx = this.absoluteTypeIndex('number');
                if (this.useProbs) {
                    const pred = this.predFieldType('number');
                    this.emitPredictedFieldType(pred, tyIdx);
                }
                written += w.writeVarUint(tyIdx);
                this.registerFieldType('number');

                written += this.encodeFloat64(val, w);
            }
            break;
          }
          default:
            throw new Error(`Unrecognized field type ${ty}`);
        }
        return written;
    }

    encodeFloat64(val: number, w: EncodingWriter): number {
        const bytes: Array<number> = Array.from(util.floatToBytes(val));
        assert(bytes.length == 8);
        let written: number = 0;
        for (let i = 0; i < 8; i++) {
            if (this.useProbs) {
                const pred = this.predFieldSpecial(`f64-${i}`, bytes[i]);
                this.emitPredictedFieldValue(pred, 'byte', bytes[i]);
            }
            w.writeByte(bytes[i]);
            this.registerFieldSpecial(`f64-${i}`, bytes[i]);
        }
        return 8;
    }

    encodeScopeEntries(prefix: string, entries: Array<S.ScopeEntry>,
                       w: EncodingWriter)
      : number
    {
        let written: number = 0;

        // Iterate through and encode lexically declared names.
        if (this.useProbs) {
            const pred = this.predFieldSpecial(`${prefix}-length`,
                                               entries.length);
            this.emitPredictedFieldValue(pred, 'uint', entries.length);
        }
        written += w.writeVarUint(entries.length);
        this.registerFieldSpecial(`${prefix}-length`, entries.length);

        for (let ent of entries) {
            const strIdx = this.absoluteStringIndex(ent.name);
            if (this.useProbs) {
                const pId = this.predFieldSpecial(`${prefix}-id`, strIdx);
                this.emitPredictedFieldValue(pId, 'string', strIdx);
            }
            this.registerFieldSpecial(`${prefix}-id`, strIdx);
            written += w.writeVarUint(strIdx);

            if (this.useProbs) {
                const pCap = this.predFieldSpecial(`${prefix}-cap`, ent.captured);
                this.emitPredictedFieldValue(pCap, 'boolean', ent.captured);
            }
            this.registerFieldSpecial(`${prefix}-cap`, ent.captured);
            written += w.writeByte(ent.captured ? 1 : 0);
        }

        return written;
    }

    encodeHasEval(prefix: string, hasEval: boolean,
                  w: EncodingWriter): number
    {
        // Iterate through and encode lexically declared names.
        if (this.useProbs) {
            const pred = this.predFieldSpecial(`${prefix}-haseval`, hasEval);
            this.emitPredictedFieldValue(pred, 'boolean', hasEval);
        }

        this.registerFieldSpecial(`${prefix}-haseval`, hasEval);

        return w.writeByte(hasEval ? 1 : 0);
    }

    encodeVarScopeField(vs: S.AssertedVarScope, w: EncodingWriter): number {
        const tyIdx = this.absoluteTypeIndex('scope');
        if (this.useProbs) {
            const pred = this.predFieldType('scope');
            this.emitPredictedFieldType(pred, tyIdx);
        }
        let written = w.writeVarUint(tyIdx);
        this.registerFieldType('scope');

        written += this.encodeScopeEntries('varscope-lexical',
                                           vs.lexicalEntries(), w);
        written += this.encodeScopeEntries('varscope-var',
                                           vs.varEntries(), w);
        written += this.encodeHasEval('varscope', vs.hasDirectEval, w);
        return written;
    }
    encodeBlockScopeField(bs: S.AssertedBlockScope, w: EncodingWriter): number {
        const tyIdx = this.absoluteTypeIndex('scope');
        if (this.useProbs) {
            const pred = this.predFieldType('scope');
            this.emitPredictedFieldType(pred, tyIdx);
        }
        let written = w.writeVarUint(tyIdx);
        this.registerFieldType('scope');

        written += this.encodeScopeEntries('blockscope-lexical',
                                           bs.lexicalEntries(), w);
        written += this.encodeHasEval('blockscope', bs.hasDirectEval, w);
        return written;
    }
    encodeParameterScopeField(ps: S.AssertedParameterScope,
                              w: EncodingWriter)
      : number
    {
        const tyIdx = this.absoluteTypeIndex('scope');
        if (this.useProbs) {
            const pred = this.predFieldType('scope');
            this.emitPredictedFieldType(pred, tyIdx);
        }
        let written = w.writeVarUint(tyIdx);
        this.registerFieldType('scope');

        written += this.encodeScopeEntries('paramscope-lexical',
                                           ps.paramEntries(), w);
        written += this.encodeHasEval('paramscope', ps.hasDirectEval, w);
        return written;
    }

    printFrequencies(): object {
        function sum(arr: any): number {
            let s: number = 0;
            for (let a of arr) { s += a; }
            return s;
        }

        // Sort freqMap by totals.
        const freqArr = Array.from(this.freqMap.keys()).sort((k1, k2) => {
            return sum(this.freqMap.get(k2).values()) - sum(this.freqMap.get(k1).values());
        });
        const jsonFreqs = {};

        freqArr.forEach((key: string) => {
            const probMap: Map<any, number> = this.freqMap.get(key);

            jsonFreqs[key] = Array.from(probMap.entries()).map(([v, c]) => {
                return {value: v, count: c};
            });

            console.log(`KVKV FreqMap`);
            console.log(`KVKV FreqMap Key ${key}`);
            const vals: Array<any> = Array.from(probMap.entries());
            vals.sort((a, b) => (b[1] - a[1]));
            let sum: number = 0;
            vals.forEach(([v, c]) => { sum += c; });
            console.log(`   KVKV FreqMap TOTAL => ${sum}`);
            vals.forEach(([v, c]) => {
                console.log(`   KVKV FreqMap ${v} => ${c}`);
            });
        });

        this.predictions.forEach((preds: Array<any>, predictor: string) => {
            console.log(`KVKV FreqMap Pred Predictor ${predictor}`);
            for (let pred_ent of preds) {
                const [p, val] = pred_ent;
                const px = ((p*64)|0)/64;
                const bits = (px == 0 ? 12 : Math.log(1/px)/Math.log(2));
                const bx = ((bits*64)|0)/64;
                console.log(`  KVKV FreqMap Pred ${px}     bits=${bx} ${val} for @${predictor}`);
            }
        });

        return jsonFreqs;
    }

    static makeProbMaps(json: any): Map<string, ProbMap> {
        const freqMap = Encoder.makeFreqMap(json);
        const result = new Map<string, ProbMap>();
        for (let key of freqMap.keys()) {
            let probMap = makeProbMap(key, freqMap.get(key), 100);
            result.set(key, probMap);
        }
        return result;
    }

    static makeFreqMap(json: any): Map<string, Map<any, number>> {
        const freqMap: Map<string, Map<any, number>> = new Map();

        for (let key of Object.getOwnPropertyNames(json)) {
            let probMap: Map<any, number> = new Map();
            for (let probEnt of json[key]) {
                assert(!probMap.has(probEnt.value));
                assert(Number.isInteger(probEnt.count));
                probMap.set(probEnt.value, probEnt.count as number);
            }
            freqMap.set(key as string, probMap);
        }
        return freqMap;
    }
}
