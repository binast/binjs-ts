
import * as assert from 'assert';

import * as S from './schema';
import * as util from './util';

import {WriteStream, ArrayWriteStream, EncodingWriter, Table}
    from './encode_binast';

const CACHE_SIZE = 1;

export class CacheArray<T> {
    readonly maxLength: number;
    readonly array: Array<T>;

    constructor(maxLength: number) {
        this.maxLength = maxLength;
        this.array = new Array<T>();
    }

    lookupAndUpdate(item: T): number {
        const idx = this.array.indexOf(item)
        if (idx >= 0) {
            this.array.splice(idx, 1);
            this.array.unshift(item);
            return idx;
        } else {
            return -1;
        }
    }

    addItem(item: T, absIdx: number): number {
        // const result = this.array.length + absIdx;
        const result = this.maxLength + absIdx;
        this.array.unshift(item);
        if (this.array.length > this.maxLength) {
            this.array.splice(this.maxLength);
        }
        return result;
    }
}

export class CompressEncoder {
    readonly stringTable: Table<string>;
    readonly nodeKindTable: Table<string>;

    readonly treeTypeStream: WriteStream;
    readonly treeTypeWriter: EncodingWriter;

    readonly treeDataStream: WriteStream;
    readonly treeDataWriter: EncodingWriter;

    readonly typeDictionary: Map<string, Map<string, CacheArray<string>>>;
    compressIndices: boolean;

    constructor(params: {stringTable: Table<string>,
                         nodeKindTable: Table<string>,
                         treeTypeStream: WriteStream,
                         treeDataStream: WriteStream})
    {
        this.compressIndices = true;

        this.stringTable = params.stringTable;
        this.nodeKindTable = params.nodeKindTable;

        this.treeTypeStream = params.treeTypeStream;
        this.treeTypeWriter = new EncodingWriter(this.treeTypeStream);

        this.treeDataStream = params.treeDataStream;
        this.treeDataWriter = new EncodingWriter(this.treeDataStream);

        this.typeDictionary = new Map();
    }

    encodeScript(script: S.Script) {
        this.encodeNodeSubtree(null, '', script);
    }

    absoluteTypeIndex(ty: string) {
        return this.nodeKindTable.index(ty);
    }
    absoluteStringIndex(str: string) {
        return this.stringTable.index(str);
    }

    getTypeCacheArray(nodeType: string, fieldName: string): CacheArray<string> {
        let nameMap = this.typeDictionary.get(nodeType);
        if (!nameMap) {
            nameMap = new Map();
            this.typeDictionary.set(nodeType, nameMap);
        }

        let cacheArray = nameMap.get(fieldName);
        if (!cacheArray) {
            cacheArray = new CacheArray<string>(CACHE_SIZE);
            nameMap.set(fieldName, cacheArray);
        }

        return cacheArray;
    }

    compressedTypeIndex(parentType: string, edgeName: string,
                        childType: string): number
    {
        const ca = this.getTypeCacheArray(parentType, edgeName);
        let idx = ca.lookupAndUpdate(childType);
        if (idx >= 0) {
            return idx;
        }
        idx = this.absoluteTypeIndex(childType);
        return ca.addItem(childType, idx);
    }

    typeIndexFor(parentNode: S.BaseNode|null, fieldName: string,
                 childNode: S.BaseNode|string|null): number
    {
        let childName: string = '';
        if (typeof(childNode) === 'string') {
            childName = childNode as string;
        } else if (childNode === null) {
            childName = 'null';
        } else {
            childName = (childNode as S.BaseNode).nodeKindName;
        }

        const absIdx = this.absoluteTypeIndex(childName);

        if (this.compressIndices) {
            let parentName: string = (parentNode === null)
                                            ? 'null'
                                            : parentNode.nodeKindName;
            let result: number = 0;
            if (parentNode === null) {
                assert(childNode instanceof S.BaseNode);
                result = this.absoluteTypeIndex(childName);
            } else {
                result = this.compressedTypeIndex(parentName, fieldName, childName);
            }

            return result;
        } else {
            return absIdx;
        }
    }

    encodeNodeSubtree(parentNode: S.BaseNode|null,
                      fieldName: string,
                      node: S.BaseNode|null)
    {
        if (node !== null && !(node instanceof S.BaseNode)) {
            console.log("GOT BAD NODE: " + JSON.stringify(node));
            throw new Error("ERROR");
        }
        assert(!Array.isArray(node));

        const self = this;

        const tyIdx = self.typeIndexFor(parentNode, fieldName, node);
        self.treeTypeWriter.writeVarUint(tyIdx);
        if (node === null) {
            return;
        }

        // Encode each child and field in order.
        node.constructor['scan']({
            child(name: string, opts?: {skippable?: boolean}) {
                const childNode = node[name] as (S.BaseNode|null);
                self.encodeNodeSubtree(node, name, childNode);
            },
            childArray(name: string) {
                assert(Array.isArray(node[name]));
                const childNodes: Array<(S.BaseNode|null)> =
                    node[name] as Array<(S.BaseNode|null)>;
                self.treeTypeWriter.writeVarUint(childNodes.length);
                for (let childNode of node[name]) {
                    self.encodeNodeSubtree(node, name, childNode);
                }
            },
            field(name: string) {
                self.encodeFieldValue(node, name, node[name]);
            }
        });
    }

    encodeFieldValue(node: S.BaseNode, fieldName: string, val: any) {
        const ty = typeof(val);
        switch (ty) {
          case 'object': {
            if (val === null) {
                // Encode a null.
                const idx = this.typeIndexFor(node, fieldName, 'null');
                this.treeTypeWriter.writeVarUint(idx);
            } else if (val instanceof S.AssertedVarScope) {
                this.encodeVarScopeField(node, fieldName,
                                         val as S.AssertedVarScope);
            } else if (val instanceof S.AssertedBlockScope) {
                this.encodeBlockScopeField(node, fieldName,
                                           val as S.AssertedBlockScope);
            } else if (val instanceof S.AssertedParameterScope) {
                this.encodeParameterScopeField(node, fieldName,
                                               val as S.AssertedParameterScope);
            } else {
                throw new Error("Cannot encode field: " + val.constructor.name);
            }
            break;
          }
          case 'string': {
            const tyIdx = this.typeIndexFor(node, fieldName, 'string');
            this.treeTypeWriter.writeVarUint(tyIdx);
            const strIdx = this.absoluteStringIndex(val as string);
            this.treeDataWriter.writeVarUint(strIdx);
            break;
          }
          case 'boolean': {
            const tyIdx = this.typeIndexFor(node, fieldName, 'boolean');
            this.treeTypeWriter.writeVarUint(tyIdx);
            this.treeDataWriter.writeByte(val ? 1 : 0);
            break;
          }
          case 'number': {
            if (Number.isInteger(val)) {
                if ((val >= 0) && (val <= 0xffffffff)) {
                    const tyIdx = this.typeIndexFor(node, fieldName, 'uint');
                    this.treeTypeWriter.writeVarUint(tyIdx);
                    this.treeDataWriter.writeVarUint(val);
                    break;
                } else {
                    const tyIdx = this.typeIndexFor(node, fieldName, 'number');
                    this.treeTypeWriter.writeVarUint(tyIdx);
                    this.treeDataWriter.writeFloat(val);
                    break;
                }
            } else { 
                assert(!Number.isInteger(val));
                const tyIdx = this.typeIndexFor(node, fieldName, 'number');
                this.treeTypeWriter.writeVarUint(tyIdx);
                this.treeDataWriter.writeFloat(val);
                break;
            }
          }
          default:
            throw new Error(`Unrecognized field type ${ty}`);
        }
    }

    encodeVarScopeField(node: S.BaseNode, fieldName: string,
                        vs: S.AssertedVarScope)
    {
        const tyIdx = this.typeIndexFor(node, fieldName, 'scope');
        this.treeTypeWriter.writeVarUint(tyIdx);
        this.encodeIndexedStringArray(vs.lexicallyDeclaredNames);
        this.encodeIndexedStringArray(vs.varDeclaredNames);
        this.encodeIndexedStringArray(vs.capturedNames);
        this.treeDataWriter.writeByte(vs.hasDirectEval ? 1 : 0);
    }
    encodeBlockScopeField(node: S.BaseNode, fieldName: string,
                          bs: S.AssertedBlockScope)
    {
        const tyIdx = this.typeIndexFor(node, fieldName, 'scope');
        this.treeTypeWriter.writeVarUint(tyIdx);
        this.encodeIndexedStringArray(bs.lexicallyDeclaredNames);
        this.encodeIndexedStringArray(bs.capturedNames);
        this.treeDataWriter.writeByte(bs.hasDirectEval ? 1 : 0);
    }
    encodeParameterScopeField(node: S.BaseNode, fieldName: string,
                              bs: S.AssertedParameterScope)
    {
        const tyIdx = this.typeIndexFor(node, fieldName, 'scope');
        this.treeTypeWriter.writeVarUint(tyIdx);
        this.encodeIndexedStringArray(bs.parameterNames);
        this.encodeIndexedStringArray(bs.capturedNames);
        this.treeDataWriter.writeByte(bs.hasDirectEval ? 1 : 0);
    }

    encodeIndexedStringArray(a: Array<string>) {
        this.treeDataWriter.writeVarUint(a.length);
        a.forEach((s: string) => {
            const strIdx = this.absoluteStringIndex(s);
            this.treeDataWriter.writeVarUint(strIdx);
        });
    }
}
