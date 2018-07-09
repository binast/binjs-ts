import * as assert from 'assert';
import { TextDecoder } from 'util';

import * as S from './schema';
import { ArrayStream, ReadStream, ReadStreamRecorder } from './io';
import { Grammar } from './grammar';
import { MruDeltaReader } from './delta';
import { rewriteAst } from './ast_util';

export class Decoder {
    readonly r: ReadStream;
    public strings: string[];
    stringStream: ReadStream;
    public grammar: Grammar;
    public program: S.Program;

    constructor(r: ReadStream) {
        this.r = r;
    }

    public decode(): void {
        this.grammar = this.decodeGrammar();
        this.strings = this.decodeStringTable();
        this.prepareStringStream();
        this.program = this.decodeAbstractSyntax();
        // TODO(dpc): Should check that the string stream is exhausted.
    }

    decodeGrammar(): Grammar {
        let length = this.r.readVarUint();
        let rules = JSON.parse(this.r.readUtf8Bytes(length));
        return new Grammar(rules);
    }

    decodeStringTable(): string[] {
        // Number of strings.
        let n = this.r.readVarUint();

        // Length of each string, bytes.
        let lengthBytes = Array(n);
        for (let i = 0; i < n; i++) {
            lengthBytes[i] = this.r.readVarUint();
        }

        // String data.
        let stringDecoder = new TextDecoder('utf-8');
        let strings = Array(n);
        for (let i = 0; i < n; i++) {
            strings[i] = stringDecoder.decode(this.r.readBytes(lengthBytes[i]));
        }

        return strings;
    }

    prepareStringStream(): void {
        let lengthBytes = this.r.readVarUint();
        this.stringStream = new ArrayStream(this.r.readBytes(lengthBytes));
    }

    readStringStream(): string {
        let index = this.stringStream.readVarUint();
        assert(0 <= index && index < this.strings.length,
            `string stream index out of bounds: ${index} of ${this.strings.length}`);
        return this.strings[index];
    }

    decodeAbstractSyntax(): S.Program {
        const num_parameters = this.r.readVarUint();
        const num_built_in_tags = this.r.readVarUint();
        if (num_built_in_tags < 7) {
            throw Error('not yet implemented: decode fewer than 7 tags');
        } else if (num_built_in_tags !== 7) {
            throw Error(`decoder too old: encountered more than 7 built-in tags (${num_built_in_tags})`);
        }
        const first_built_in_tag = num_parameters;
        const tag_nil = first_built_in_tag + 0;
        const tag_string = first_built_in_tag + 1;
        const tag_null = first_built_in_tag + 2;
        const tag_cons = first_built_in_tag + 3;
        const tag_false = first_built_in_tag + 4;
        const tag_true = first_built_in_tag + 5;
        const tag_undefined = first_built_in_tag + 6;

        const first_meta_rule = first_built_in_tag + num_built_in_tags;
        const num_ranks = this.r.readVarUint() + 1;
        // The i-th rank's rules have this many parameters.
        const ranks = Array(num_ranks);
        ranks[0] = 0;
        // The next i-th rank's rule should appear at this offset.
        const rank_offset = Array(num_ranks + 1);
        rank_offset[0] = 0;
        rank_offset[1] = this.r.readVarUint();
        let meta_rule_size_offset = new Map<number, number>([[0, 0]]);
        for (let i = 1; i < num_ranks; i++) {
            ranks[i] = ranks[i - 1] + this.r.readVarUint() + 1;
            rank_offset[i + 1] = rank_offset[i] + this.r.readVarUint();
        }
        const num_meta_rules = rank_offset[num_ranks];

        const first_grammar_rule = first_meta_rule + num_meta_rules;
        const num_grammar_rules = this.grammar.rules.size;

        const first_numeric_constant = first_grammar_rule + num_grammar_rules;
        const num_numeric_constants = this.r.readVarUint();
        const numeric_constants = Array(num_numeric_constants);
        for (let i = 0; i < num_numeric_constants; i++) {
            numeric_constants[i] = this.decodeFloat();
        }

        // Given an index into the meta rules, returns the rank of that rule.
        let meta_rank = (i: number): number => {
            assert(0 <= i && i < num_meta_rules, `${i}`);
            // TODO(dpc): This should binary search.
            for (let i = 0; i < num_ranks; i++) {
                if (i < rank_offset[i + 1]) {
                    return ranks[i];
                }
            }
            assert(false, 'unreachable');
        };

        // Reads and caches tree data.
        let buffer_tree = (n: number, buffer: number[]): number[] => {
            for (let i = 0; i < n; i++) {
                const tag = this.r.readVarUint();
                buffer.push(tag);
                if (tag === tag_cons) {
                    buffer_tree(2, buffer);
                } else if (first_meta_rule <= tag && tag < first_grammar_rule) {
                    buffer_tree(meta_rank(tag - first_meta_rule), buffer);
                } else if (first_grammar_rule <= tag && tag < first_numeric_constant) {
                    let kind = this.grammar.indexRuleMap.get(tag - first_grammar_rule);
                    buffer_tree(this.grammar.rules.get(kind).length, buffer);
                } else {
                    // Nothing to do!
                }
            }
            return buffer;
        };

        // Read the meta rules.
        let rank_i = 0;
        let meta_rules = Array(num_meta_rules);
        for (let i = 0; i < num_meta_rules; i++) {
            while (rank_offset[rank_i + 1] < i) {
                rank_i++;
            }
            meta_rules[i] = buffer_tree(1, []);
        }

        let tree = buffer_tree(1, []);

        // TODO: working here on decoding
        let replay_tree = (tree: number[], actuals: any[]): any => {
            const tag = tree.shift();
            if (tag === tag_nil) {
                return [];
            } else if (tag === tag_string) {
                return this.strings[this.stringStream.readVarUint()];
            } else if (tag === tag_null) {
                return null;
            } else if (tag === tag_cons) {
                // TODO, lists:
            }
        };

        return replay_tree(tree, []);
    }

    private decodeFloat(): number {
        let buf = this.r.readBytes(8);
        let float_buf = new Float64Array(buf.buffer.slice(0, 8));
        return float_buf[0];
    }
}
