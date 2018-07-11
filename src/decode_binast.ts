import * as assert from 'assert';
import { TextDecoder } from 'util';

import * as S from './schema';
import { ArrayStream, ReadStream, ReadStreamRecorder } from './io';
import { Grammar } from './grammar';
import { MruDeltaReader } from './delta';
import { rewriteAst } from './ast_util';

type StackFrame = {
    debug_tag: number,
    tree: Iterator<number>;
    actuals: StackFrame;
};

export class Decoder {
    readonly r: ReadStream;
    public grammar: Grammar;
    public program: S.Program;

    constructor(r: ReadStream) {
        this.r = r;
    }

    public decode(): void {
        this.grammar = this.decodeGrammar();
        this.program = this.decodeAbstractSyntax();
    }

    decodeGrammar(): Grammar {
        let length = this.r.readVarUint();
        let source = this.r.readUtf8Bytes(length);
        let rules = JSON.parse(source);
        return new Grammar(rules);
    }

    decodeAbstractSyntax(): S.Program {
        const num_parameters = this.r.readVarUint();
        const num_built_in_tags = this.r.readVarUint();
        if (num_built_in_tags < 6) {
            throw Error('not yet implemented: decode fewer than 6 tags');
        } else if (num_built_in_tags !== 6) {
            throw Error(`decoder too old: encountered more than 6 built-in tags (${num_built_in_tags})`);
        }
        const first_built_in_tag = num_parameters;
        const tag_nil = first_built_in_tag + 0;
        const tag_null = first_built_in_tag + 1;
        const tag_cons = first_built_in_tag + 2;
        const tag_false = first_built_in_tag + 3;
        const tag_true = first_built_in_tag + 4;
        const tag_undefined = first_built_in_tag + 5;

        const first_meta_rule = first_built_in_tag + num_built_in_tags;
        const num_meta_rules = this.r.readVarUint();
        const last_meta_rule = first_meta_rule + num_meta_rules - 1;

        const first_grammar_rule = first_meta_rule + num_meta_rules;
        const num_grammar_rules = this.grammar.rules.size;
        const last_grammar_rule = first_grammar_rule + num_grammar_rules - 1;

        const first_string_constant = first_grammar_rule + num_grammar_rules;
        const num_string_constants = this.r.readVarUint();
        const last_string_constant = first_string_constant + num_string_constants - 1;
        const string_lengths = Array(num_string_constants);
        const string_constants = Array(num_string_constants);
        for (let i = 0; i < num_string_constants; i++) {
            string_lengths[i] = this.r.readVarUint();
        }
        for (let i = 0; i < num_string_constants; i++) {
            string_constants[i] = this.r.readUtf8Bytes(string_lengths[i]);
        }

        const first_numeric_constant = first_string_constant + num_string_constants;
        const num_numeric_constants = this.r.readVarUint();
        const last_numeric_constant = first_numeric_constant + num_numeric_constants - 1;
        const numeric_constants = Array(num_numeric_constants);
        for (let i = 0; i < num_numeric_constants; i++) {
            numeric_constants[i] = this.decodeFloat();
        }

        // Read the lengths of meta rules, in bytes.
        const meta_rule_lengths = Array(num_meta_rules);
        for (let i = 0; i < num_meta_rules; i++) {
            meta_rule_lengths[i] = this.r.readVarUint();
        }

        // Read the meta rule data to replay it later.
        const meta_rules = Array(num_meta_rules);
        for (let [i, size] of meta_rule_lengths.entries()) {
            meta_rules[i] = this.r.readBytes(size);
        }

        // Read the size of the tree.
        // TODO(dpc): When skipping we will need metadata about that, including this length.
        const _start_length = this.r.readVarUint();

        // This produces the codes in the tail of the file.
        let rest = function* () {
            while (true) {
                yield this.r.readVarUint();
            }
        }.bind(this);
        // This produces the codes for a meta-rule from a buffer.
        let read_meta_rule = function* (buffer) {
            const r = new ArrayStream(buffer);
            while (true) {
                yield r.readVarUint();
            }
        };

        // The top stack frame...
        let stack: StackFrame[] = [{
            debug_tag: 0,
            tree: rest(),       // ... consumes the rest of the file.
            actuals: null,      // ... does not have parameters.
        }];
        let tos = (): StackFrame => stack[stack.length - 1];
        let actuals = (): StackFrame => tos().actuals;
        let next_at_tos = (): number => tos().tree.next().value;

        // TODO(dpc): Keep the TOS in a variable.
        // The protocol here: The caller pushes and pops.
        let replay_tree = (debug: boolean): any => {
            let d = debug ? console.log : (...arg) => void (0);
            let tag = next_at_tos();
            if (tag === tag_nil) {
                d('prim:nil', tos().debug_tag);
                return [];
            } else if (tag === tag_null) {
                d('prim:null', tos().debug_tag);
                return null;
            } else if (tag === tag_cons) {
                d('prim:cons', tos().debug_tag);
                const elem = replay_tree(debug);
                const rest = replay_tree(debug);
                rest.unshift(elem);
                return rest;
            } else if (tag === tag_false) {
                d('prim:false', tos().debug_tag);
                return false;
            } else if (tag === tag_true) {
                d('prim:true', tos().debug_tag);
                return true;
            } else if (tag === tag_undefined) {
                d('prim:undefined', tos().debug_tag);
                return undefined;
            } else if (0 <= tag && tag < num_parameters) {
                d(`param:${tag}`, tos().debug_tag);
                stack.push(actuals());
                const result = replay_tree(false);
                stack.pop();
                return result;
            } else if (first_meta_rule <= tag && tag <= last_meta_rule) {
                const rule_i = tag - first_meta_rule;
                d(`P${rule_i}`, tos().debug_tag);
                stack.push({
                    debug_tag: tos().debug_tag + 1,
                    tree: read_meta_rule(meta_rules[rule_i]),
                    actuals: tos(),
                });
                const result = replay_tree(false);
                stack.pop();
                return result;
            } else if (first_grammar_rule <= tag && tag <= last_grammar_rule) {
                const kind = this.grammar.nodeType(tag - first_grammar_rule);
                const props = this.grammar.rules.get(kind);
                d(`node:${kind}/${props.length}`, tos().debug_tag);
                const params = {};
                for (let prop of props) {
                    params[prop] = replay_tree(debug);
                }
                return new S[kind](params);
            } else if (first_string_constant <= tag && tag <= last_string_constant) {
                const i = tag - first_string_constant;
                const s = string_constants[i];
                d(`string:${s}`, tos().debug_tag);
                return s;
            } else if (first_numeric_constant <= tag && tag <= last_numeric_constant) {
                const i = tag - first_numeric_constant;
                assert(0 <= i && i < numeric_constants.length);
                const n = numeric_constants[i];
                d(`float:${n}`, tos().debug_tag);
                return n;
            } else {
                assert(false, `unreachable, read a bogus tag ${tag}`);
            }
        }

        const result = replay_tree(false);
        assert(stack.length == 1);
        // TODO(dpc): Remove this assertion when streaming.
        // TODO(dpc): Make rest() to stop at end of file and enable this assertion.
        //assert(tos().tree.next().done);
        return result;
    }

    private decodeFloat(): number {
        let buf = this.r.readBytes(8);
        let float_buf = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        return float_buf[0];
    }
}
