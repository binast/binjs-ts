
"use strict";

import * as S from './schema';
const assert = require('assert');

const UNICODE_SPLO_BEG= 0xD800;
const UNICODE_SPLO_END = 0xDC00;
const UNICODE_SPHI_END = 0xE000;

export function jsStringToWtf8Bytes(str: string): Array<number> {
    return codepointsToWtf8(stringToWobblyCodepoints(str));
}

export function stringToWobblyCodepoints(str: string): Array<number> {
    const result: Array<number> = [];
    let expectNonSP: boolean = true;
    let sp0: number;
    for (let i = 0; i < str.length; i++) {
        const cc = str.charCodeAt(i);
        assert(cc >= 0 && cc < 0x10000);
        if (expectNonSP) {
            // Normal case.
            if (cc < UNICODE_SPLO_BEG) {
                result.push(cc);
            } else if (cc < UNICODE_SPLO_END) {
                sp0 = cc;
                expectNonSP = false;
            } else {
                // All other characters are either
                // invalid surrogate pairs, or valid
                // codepoints.
                result.push(cc);
            }
        } else {
            // We expect a high surrogate pair half.
            if (cc < UNICODE_SPLO_END) {
                // Either a non-surrogate code or a low
                // surrogate half.
                // Previous low surrogate pair entry
                // was bad, push that as-is and this
                // one as-is.
                result.push(sp0);
                result.push(cc);
            } else if (cc < UNICODE_SPHI_END) {
                // Got valid Hi-Lo surrogate pair.
                // Compute the unicode codepoint and push it.
                const high10 = sp0 & 0x3F;
                const low10 = cc & 0x3F;
                result.push(((high10 << 10) + low10) + 0x10000);
            } else {
                // Previous low surrogate pair half
                // was bad, push that as-is and this
                // one as-is.
                result.push(sp0);
                result.push(cc);
            }
            expectNonSP = true;
        }
    }
    if (!expectNonSP) {
        // Dangling low-surrogate half.
        result.push(sp0);
    }
    return result;
}

export function codepointsToWtf8(cps: Array<number>): Array<number> {
    const bytes: Array<number> = [];
    for (let cp of cps) {
        encodeCodepointAppend(cp, bytes);
    }
    return bytes;
}

function encodeCodepointAppend(cp: number, bytes: Array<number>) {
    assert(cp <= 0x10_ffff);

    if (cp < 0b1_0000_0000) {
        // 7 bits
        bytes.push(cp);
        return;
    }if (cp < 0b1_000_0000_0000) {
        // 6 + 5 = 11 bits
        bytes.push(((cp >> 6) & 0b0001_1111) | 0b1100_0000);
        bytes.push((cp & 0b0011_1111) | 0b1000_0000);
    } else if (cp < 0b1_0000_0000_0000_0000) {
        // 6 + 6 + 4 = 16 bits
        bytes.push(((cp >> 12) & 0b0000_1111) | 0b1110_0000);
        bytes.push(((cp >> 6) & 0b0011_1111) | 0b1000_0000);
        bytes.push((cp & 0b0011_1111) | 0b1000_0000);
    } else {
        assert(cp < 0b1_0_0000_0000_0000_0000_0000);

        // 6 + 6 + 6 + 3 = 21 bits
        bytes.push(((cp >> 18) & 0b0000_0111) | 0b1111_0000);
        bytes.push(((cp >> 12) & 0b0011_1111) | 0b1000_0000);
        bytes.push(((cp >> 6) & 0b0011_1111) | 0b1000_0000);
        bytes.push((cp & 0b0011_1111) | 0b1000_0000);
    }
}

export function fieldTypeForValue(val: any): S.FieldType {
    switch (typeof(val)) {
        case 'object': {
            if (val === null) {
                return S.FieldType.Null;
            } else if (val instanceof S.AssertedVarScope) {
                return S.FieldType.VarScope;
            } else if (val instanceof S.AssertedBlockScope) {
                return S.FieldType.BlockScope;
            } else if (val instanceof S.AssertedParameterScope) {
                return S.FieldType.ParameterScope;
            } else {
                throw new Error("Cannot encode field: " + val.constructor.name);
            }
        }
        case 'string': {
            return S.FieldType.String;
        }
        case 'boolean': {
            return S.FieldType.Boolean;
        }
        case 'number': {
            if (Number.isInteger(val)) {
                if ((val >= 0) && (val <= 0x7fff_ffff)) {
                    return S.FieldType.Integer;
                } else {
                    return S.FieldType.Number;
                }
            } else { 
                assert(!Number.isInteger(val));
                return S.FieldType.Number;
            }
        }
        default: {
            throw new Error("Cannot encode field: " + val);
        }
    }
}
