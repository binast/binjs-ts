
import * as assert from 'assert';

import * as S from './schema';
import * as util from './util';

export interface WriteStream {
    writeByte(b: number): number;
    writeArray(bs: Array<number>): number;
}

const FIXED_SIZE: number = 0x10000;

// TODO: Improve this to flush to a backing-list of Uint8Arrays.  Then
//       they can be iterated over efficiently, and concatenating
//       different streams would become much faster and easier on
//       the GC (e.g. when creating sub-streams for lazy elements which
//       need to be prefixed with their encoded length).
export class ArrayWriteStream implements WriteStream {
    array: Array<number>;
    
    constructor() {
        this.array = new Array<number>();
    }

    get size(): number {
        return this.array.length;
    }

    writeByte(b: number): number {
        this.array.push(b);
        return 1;
    }

    writeArray(bs: Array<number>): number {
        this.array.push(...bs);
        return bs.length;
    }
}

export class EncodingWriter {
    readonly stream: WriteStream;

    constructor(stream) {
        this.stream = stream;
    }

    writeByte(b: number): number {
        return this.stream.writeByte(b);
    }
    writeArray(bs: Array<number>): number {
        return this.stream.writeArray(bs);
    }

    private writeNonTerminalByte(b: number) {
        // ASSERT: Number.isInteger(b) && (b >= 0) && (b < 128)
        this.writeByte(b | 0x80);
    }
    writeVarUint(uval: number): number {
        // ASSERT: Number.isInteger(uval);
        // ASSERT: uval >= 0;
        // ASSERT: uval <= 0xFFFFFFFF

        // 7-bit number.
        if (uval < 0x80) {
            this.writeByte(uval);
            return 1;
        }

        // 14-bit number.
        if (uval < 0x4000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeByte((uval >> 7) & 0x7F);
            return 2;
        }

        // 21-bit number.
        if (uval < 0x200000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeByte((uval >> 14) & 0x7F);
            return 3;
        }

        // 28-bit number.
        if (uval < 0x10000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeByte((uval >> 21) & 0x7F);
            return 4;
        }

        // 35-bit number.
        if (uval < 0x800000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeNonTerminalByte((uval >> 21) & 0x7F);
            this.writeByte((uval >> 28) & 0x7F);
            return 5;
        }

        // 42-bit number.
        if (uval < 0x40000000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeNonTerminalByte((uval >> 21) & 0x7F);
            this.writeNonTerminalByte((uval >> 28) & 0x7F);
            this.writeByte((uval >> 35) & 0x7F);
            return 6;
        }

        // 49-bit number.
        if (uval < 0x2000000000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeNonTerminalByte((uval >> 21) & 0x7F);
            this.writeNonTerminalByte((uval >> 28) & 0x7F);
            this.writeByte((uval >> 35) & 0x7F);
            return 6;
        }

        assert(uval < 0x2000000000000, `Value ${uval} out of range`);
    }

    writeFloat(f: number): number {
        return this.writeInlineString(f.toString());
    }

    writeInlineString(s: string): number {
        const bytes = util.jsStringToWtf8Bytes(s);
        return this.writeVarUint(bytes.length) + this.writeArray(bytes);
    }
}

export class Table<T> {
    // Array of all values in order
    readonly vals: Array<T>;

    // Map of each value to its array index.
    readonly table: Map<T, number>;

    constructor(vals: Array<T>) {
        this.vals = vals;

        const table: Map<T, number> = new Map();
        vals.forEach((s: T, i: number) => {
            table.set(s, i);
        });
        this.table = table;
    }

    index(v: T): number {
        const r: number = this.table.get(v);
        assert(Number.isInteger(r), `No table entry for '${v}'`);
        return r;
    }

    each(cb: (str: T, i?: number) => void) {
        this.vals.forEach(cb);
    }

    get size(): number {
        return this.table.size;
    }
}

export const MAGIC_STRING: string = 'BINJS';
export const FORMAT_VERSION: number = 0;

export const HEADER_STRINGS_TABLE: string = '[STRINGS]';
export const HEADER_GRAMMAR_TABLE: string = '[GRAMMAR]';
export const HEADER_TREE: string = '[TREE]';

import {WriteStream} from './encode_binast';

export class Encoder {
    readonly stringTable: Table<string>;
    readonly nodeKindTable: Table<string>;
    tabbing: number;

    constructor(params: {stringTable: Table<string>,
                         nodeKindTable: Table<string>})
    {
        this.stringTable = params.stringTable;
        this.nodeKindTable = params.nodeKindTable;
        this.tabbing = 0;
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

        // Encode each child and field in order.
        node.constructor['scan']({
            child(name: string, opts?: {skippable?: boolean}) {
                const childNode = node[name] as (S.BaseNode|null);
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
            },
            childArray(name: string) {
                assert(Array.isArray(node[name]));
                const childNodes: Array<(S.BaseNode|null)> =
                    node[name] as Array<(S.BaseNode|null)>;
                written += w.writeVarUint(childNodes.length);
                for (let childNode of node[name]) {
                    written += self.encodeNodeSubtree(childNode, w);
                }
            },
            field(name: string) {
                written += self.encodeFieldValue(node[name], w);
            }
        });

        return written;
    }

    encodeFieldValue(val: any, w: EncodingWriter): number {
        const ty = typeof(val);
        let written = 0;
        switch (ty) {
          case 'object': {
            if (val === null) {
                // Encode a null.
                const idx = this.absoluteTypeIndex('null');
                written += w.writeVarUint(idx);
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
            const strIdx = this.absoluteStringIndex(val as string);
            written += w.writeVarUint(tyIdx);
            written += w.writeVarUint(strIdx);
            break;
          }
          case 'boolean': {
            const tyIdx = this.absoluteTypeIndex('boolean');
            written += w.writeVarUint(tyIdx);
            written += w.writeByte(val ? 1 : 0);
            break;
          }
          case 'number': {
            if (Number.isInteger(val)) {
                if ((val >= 0) && (val <= 0xffffffff)) {
                    const tyIdx = this.absoluteTypeIndex('uint');
                    written += w.writeVarUint(tyIdx);
                    written += w.writeVarUint(val);
                    break;
                } else {
                    const tyIdx = this.absoluteTypeIndex('number');
                    written += w.writeVarUint(tyIdx);
                    written += w.writeFloat(val);
                    break;
                }
            } else { 
                assert(!Number.isInteger(val));
                const tyIdx = this.absoluteTypeIndex('number');
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
}
