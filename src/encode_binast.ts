
import * as assert from 'assert';
import * as fs from 'fs';

import * as S from './schema';
import * as util from './util';
import {buildPrefixCuts} from './tree_template';

import {WriteStream, ArrayWriteStream, EncodingWriter, Table}
    from './write_stream';


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

export class Encoder {
    readonly stringTable: Table<string>;
    readonly nodeKindTable: Table<string>;
    readonly freqMap: Map<string, Map<any, number>>;
    readonly predictions: Map<string, Array<any>>;
    readonly curPath: Array<PathEntry>;
    tabbing: number;

    constructor(params: {stringTable: Table<string>,
                         nodeKindTable: Table<string>})
    {
        this.stringTable = params.stringTable;
        this.nodeKindTable = params.nodeKindTable;
        this.freqMap = new Map();
        this.predictions = new Map();
        this.curPath = [];
        this.tabbing = 0;
    }

    checkPrediction(predictor: string, value: any): number {
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

    registerProb(predictor: string, value: any) {
        const preds = this.predictions.get(predictor);
        const pr = this.checkPrediction(predictor, value);
        if (preds) {
            preds.push([pr, value]);
        } else {
            this.predictions.set(predictor, [[pr, value]]);
        }

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
    makePredictors(extra?: string): Array<string> {
        extra = extra ? "@" + extra : "";
        const preds: Array<string> = [];
        if (this.curPath.length > 0) {
            const p1 = this.curPath[this.curPath.length - 1].toString() + extra;
            // preds.push(p1);
            if (this.curPath.length > 1) {
                const p2 = this.curPath[this.curPath.length - 2].toString();
                preds.push(`${p2} -- ${p1}`);
            }
        }
        return preds;
    }

    registerChildType(childTypeName: string) {
        for (let predictor of this.makePredictors()) {
            this.registerProb(predictor, childTypeName);
        }
    }
    registerFieldType(fieldTypeName: string) {
        for (let predictor of this.makePredictors()) {
            this.registerProb(predictor, fieldTypeName);
        }
    }
    registerFieldValue(fieldTypeName: string, fieldValue: any) {
        for (let predictor of this.makePredictors(fieldTypeName)) {
            this.registerProb(predictor, fieldValue);
        }
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
        }

        let written = 0;

        // Look up the node constructor's index.
        const kind: string = node.nodeKindName;
        const idx = self.absoluteTypeIndex(kind);

        // Write out the type of the node.
        written += w.writeVarUint(idx);

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
                written += w.writeVarUint(childNodes.length);

                self.curPath.push(new PathEntry(node, '::', name + '[]'));

                for (let childNode of node[name]) {
                    self.registerChildType(childNode.nodeKindName);
                    written += self.encodeNodeSubtree(childNode, w);
                }

                self.curPath.pop();
            },
            field(name: string, ty?:S.FieldType|null) {
                if (ty) {
                    console.log(`xxx TYPED FIELD ${node.nodeKindName}.${name}: ${ty}`);
                }
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
                const idx = this.absoluteTypeIndex('null');
                written += w.writeVarUint(idx);
                this.registerFieldType('null');
            } else if (val instanceof S.AssertedVarScope) {
                written += this.encodeVarScopeField(
                                val as S.AssertedVarScope, w);
                this.registerFieldType('varscope');
            } else if (val instanceof S.AssertedBlockScope) {
                written += this.encodeBlockScopeField(
                                val as S.AssertedBlockScope, w);
                this.registerFieldType('blockscope');
            } else if (val instanceof S.AssertedParameterScope) {
                written += this.encodeParameterScopeField(
                                val as S.AssertedParameterScope, w);
                this.registerFieldType('paramscope');
            } else {
                throw new Error("Cannot encode field: " + val.constructor.name);
            }
            break;
          }
          case 'string': {
            this.registerFieldType('string');
            const tyIdx = this.absoluteTypeIndex('string');
            const strIdx = this.absoluteStringIndex(val as string);
            this.registerFieldValue('string', strIdx);
            written += w.writeVarUint(tyIdx);
            written += w.writeVarUint(strIdx);
            break;
          }
          case 'boolean': {
            this.registerFieldType('boolean');
            const tyIdx = this.absoluteTypeIndex('boolean');
            this.registerFieldValue('boolean', val);
            written += w.writeVarUint(tyIdx);
            written += w.writeByte(val ? 1 : 0);
            break;
          }
          case 'number': {
            if (Number.isInteger(val)) {
                if ((val >= 0) && (val <= 0xffffffff)) {
                    this.registerFieldType('uint');
                    const tyIdx = this.absoluteTypeIndex('uint');
                    this.registerFieldValue('uint', val);
                    written += w.writeVarUint(tyIdx);
                    written += w.writeVarUint(val);
                    break;
                } else {
                    this.registerFieldType('number');
                    const tyIdx = this.absoluteTypeIndex('number');
                    this.registerFieldValue('number', val);
                    written += w.writeVarUint(tyIdx);
                    written += w.writeFloat(val);
                    break;
                }
            } else { 
                this.registerFieldType('number');
                assert(!Number.isInteger(val));
                const tyIdx = this.absoluteTypeIndex('number');
                this.registerFieldValue('number', val);
                written += w.writeVarUint(tyIdx);
                written += w.writeFloat(val);
                break;
            }
          }
          default:
            throw new Error(`Unrecognized field type ${ty}`);
        }
        return written;
    }

    encodeVarScopeField(vs: S.AssertedVarScope, w: EncodingWriter): number {
        const tyIdx = this.absoluteTypeIndex('scope');
        let written = w.writeVarUint(tyIdx);
        written += this.encodeIndexedStringArray(vs.lexicallyDeclaredNames, w);
        written += this.encodeIndexedStringArray(vs.varDeclaredNames, w);
        written += this.encodeIndexedStringArray(vs.capturedNames, w);
        written += w.writeByte(vs.hasDirectEval ? 1 : 0);
        return written;
    }
    encodeBlockScopeField(bs: S.AssertedBlockScope, w: EncodingWriter): number {
        const tyIdx = this.absoluteTypeIndex('scope');
        let written = w.writeVarUint(tyIdx);
        written += this.encodeIndexedStringArray(bs.lexicallyDeclaredNames, w);
        written += this.encodeIndexedStringArray(bs.capturedNames, w);
        written += w.writeByte(bs.hasDirectEval ? 1 : 0);
        return written;
    }
    encodeParameterScopeField(bs: S.AssertedParameterScope,
                              w: EncodingWriter)
      : number
    {
        const tyIdx = this.absoluteTypeIndex('scope');
        let written = w.writeVarUint(tyIdx);
        written += this.encodeIndexedStringArray(bs.parameterNames, w);
        written += this.encodeIndexedStringArray(bs.capturedNames, w);
        written += w.writeByte(bs.hasDirectEval ? 1 : 0);
        return written;
    }

    encodeIndexedStringArray(a: Array<string>, w: EncodingWriter): number {
        return w.writeVarUint(a.length) +
            a.reduce((p: number, s: string): number => {
                const strIdx = this.absoluteStringIndex(s);
                return p + w.writeVarUint(strIdx);
            }, 0);
    }

    printFrequencies() {
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
        fs.writeFileSync('/tmp/JSON_DUMP', JSON.stringify(jsonFreqs));

        this.predictions.forEach((preds: Array<any>, predictor: string) => {
            console.log(`KVKV FreqMap Pred Predictor ${predictor}`);
            for (let pred_ent of preds) {
                const [p, val] = pred_ent;
                const px = ((p*32)|0)/32;
                const bits = (px == 0 ? 12 : Math.log(1/px)/Math.log(2));
                const bx = ((bits*64)|0)/64;
                console.log(`  KVKV FreqMap Pred ${px}     bits=${bx} ${val} for @${predictor}`);
            }
        });
    }

    loadFrequenciesJson(json: any) {
        this.freqMap.clear();
        for (let key of Object.getOwnPropertyNames(json)) {
            let probMap: Map<any, number> = new Map();
            for (let probEnt of json[key]) {
                assert(!probMap.has(probEnt.value));
                assert(Number.isInteger(probEnt.count));
                probMap.set(probEnt.value, probEnt.count as number);
            }
            this.freqMap.set(key as string, probMap);
        }
    }
}
