
"use strict";

const assert = require('assert');

const UNICODE_SPLO_BEG= 0xD800;
const UNICODE_SPLO_END = 0xDC00;
const UNICODE_SPHI_END = 0xE000;

export function jsStringToUtf8Bytes(str: string): Uint8Array {
    return codepointsToUtf8(stringToCodepoints(str));
}

export function stringToCodepoints(str: string): Array<number> {
    const result: Array<number> = [];
    let normalMode: boolean = true;
    let sp0: number;
    for (let i = 0; i < str.length; i++) {
        const cc = str.charCodeAt(i);
        assert(cc >= 0 && cc < 0x10000);
        if (normalMode) {
            if (cc < UNICODE_SPLO_BEG) {
                result.push(cc);
            } else if (cc < UNICODE_SPLO_END) {
                sp0 = cc;
                normalMode = false;
            } else {
                // All other characters are either
                // invalid surrogate pairs, or valid
                // codepoints.
                result.push(cc);
            }
        } else {
            // We expect a high surrogate pair entry.
            if (cc < UNICODE_SPLO_END) {
                // Previous low surrogate pair entry
                // was bad, push that as-is and this
                // one as-is.
                result.push(sp0);
                result.push(cc);
                normalMode = true;
            } else if (cc < UNICODE_SPHI_END) {
                // Compute the unicode codepoint and push it.
                const high10 = sp0 & 0x3F;
                const low10 = cc & 0x3F;
                result.push(((high10 << 10) + low10) + 0x10000);
                normalMode = true;
            } else {
                // Previous low surrogate pair entry
                // was bad, push that as-is and this
                // one as-is.
                result.push(sp0);
                result.push(cc);
                normalMode = true;
            }
        }
    }
    if (!normalMode) {
        result.push(sp0);
    }
    return result;
}

export function codepointsToUtf8(cps: Array<number>): Uint8Array {
    const bytes: Array<number> = [];
    for (let cp of cps) {
        encodeCodepointAppend(cp, bytes);
    }
    return new Uint8Array(bytes);
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
