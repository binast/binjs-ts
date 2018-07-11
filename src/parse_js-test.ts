import { parseScript } from 'shift-parser';
import { Importer } from './parse_js';
import * as S from './schema';

import { describe, it } from 'mocha';
import { expect } from 'chai';

function compileAndTest(js_text, checkAST) {
    const json = parseScript(js_text);
    if (json.type !== 'Script')
        throw new Error('Shift parser ate it?');
    const importer = new Importer();
    const script = importer.liftScript(json);

//        console.log(JSON.stringify(script, null, 2));
    checkAST(script);
}

function checkVarScope(scope, lexicals, varDecls, captures) {
    expect(scope.lexicallyDeclaredNames).to.deep.equal(lexicals);
    expect(scope.varDeclaredNames).to.deep.equal(varDecls);
    expect(scope.capturedNames).to.deep.equal(captures);
}

describe('Declared and Captured Names', () => {
    it('should put top-level vars in AssertedVarScope', () => {
        compileAndTest('var foo;', ast => {
            checkVarScope(ast.scope, [], ['foo'], []);
        });
    });
    it('should put top-level function decls in AssertedVarScope', () => {
        compileAndTest('function foo() { }', ast => {
            checkVarScope(ast.scope, [], ['foo'], []);
        });
    });
    it('should note captured top-level vars', () => {
        compileAndTest('var foo; function bar() { foo(); }', ast => {
            checkVarScope(ast.scope, [], ['foo', 'bar'], ['foo']);
        });
    });
    it('should note captured top-level functions', () => {
        compileAndTest('function foo() {}; function bar() { foo(); }', ast => {
            checkVarScope(ast.scope, [], ['foo', 'bar'], ['foo']);
        });
    });
});
