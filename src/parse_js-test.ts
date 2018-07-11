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

function checkParameterScope(scope, parameters, captures) {
    expect(scope.parameterNames).to.deep.equal(parameters);
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
    it('should elide FunctionDefinition name from parameter decls', () => {
        compileAndTest('function foo() { }', ast => {
            const func = ast.statements[0];
            checkParameterScope(func.parameterScope, [], []);
            checkVarScope(func.bodyScope, [], [], []);
        });
    });
    it('should elide FunctionExpression name from parameter decls', () => {
        compileAndTest('(function foo() { })', ast => {
            const func = ast.statements[0].expression;
            checkParameterScope(func.parameterScope, [], []);
            checkVarScope(func.bodyScope, [], [], []);
        });
    });
    it('should capture outer var binding for FunctionDefinition recursion', () => {
        compileAndTest('function foo() { foo(); }', ast => {
            checkVarScope(ast.scope, [], ['foo'], ['foo']);
        });
    });
    it('should not capture function expression name for direct recursion in parameter scope', () => {
        compileAndTest('(function foo() { foo(); })', ast => {
            const func = ast.statements[0].expression;
            checkParameterScope(func.parameterScope, [], []);
        });
    });
    it('should capture hacky non-standard FunctionExpression name in parameter scope', () => {
        compileAndTest('(function foo() { (function inner() { foo(); }); })', ast => {
            const func = ast.statements[0].expression;
            checkParameterScope(func.parameterScope, [], ['foo']);
        });
    });
    it('should not capture directly used parameters in FunctionDefinition', () => {
        compileAndTest('function foo(a) { a(); }', ast => {
            const func = ast.statements[0];
            checkParameterScope(func.parameterScope, ['a'], []);
        });
    });
    it('should capture nestedly used parameters in FunctionDefinition', () => {
        compileAndTest('function foo(a) { (function () { a(); }); }', ast => {
            const func = ast.statements[0];
            checkParameterScope(func.parameterScope, ['a'], ['a']);
        });
    });
    it('should handle name shadowing in FunctionExpression parameter scope', () => {
        compileAndTest('(function foo(foo) { })', ast => {
            const func = ast.statements[0].expression;
            checkParameterScope(func.parameterScope, ['foo'], []);
            checkVarScope(func.bodyScope, [], [], []);
        });
    });
});
