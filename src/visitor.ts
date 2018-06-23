
"use strict";

import * as assert from 'assert';
import * as S from './schema';

export interface NodeVisitor {
    visit(node: S.BaseNode, name: string, opts?: {skippable?: boolean});
}

export abstract class DefaultNodeVisitor implements NodeVisitor {
    constructor() {}

    visit(node: S.BaseNode, name: string, opts?: {skippable?: boolean}) {
        this.dispatchVisit(node);
    }
    
    dispatchVisit(node: S.BaseNode) {
        const name = 'visit' + node.constructor.name;
        this[name](node);
    }

    visitBindingIdentifier(node: S.BindingIdentifier) {}
    visitBindingWithInitializer(node: S.BindingWithInitializer) {}
    visitAssignmentTargetIdentifier(node: S.AssignmentTargetIdentifier) {}
    visitComputedMemberAssignmentTarget(
        node: S.ComputedMemberAssignmentTarget)
    {}
    visitStaticMemberAssignmentTarget(node: S.StaticMemberAssignmentTarget) {}
    visitArrayBinding(node: S.ArrayBinding) {}
    visitBindingPropertyIdentifier(node: S.BindingPropertyIdentifier) {}
    visitBindingPropertyProperty(node: S.BindingPropertyProperty) {}
    visitObjectBinding(node: S.ObjectBinding) {}
    visitAssignmentTargetWithInitializer(
        node: S.AssignmentTargetWithInitializer)
    {}
    visitArrayAssignmentTarget(node: S.ArrayAssignmentTarget) {}
    visitAssignmentTargetPropertyIdentifier(
        node: S.AssignmentTargetPropertyIdentifier)
    {}
    visitAssignmentTargetPropertyProperty(
        node: S.AssignmentTargetPropertyProperty)
    {}
    visitObjectAssignmentTarget(node: S.ObjectAssignmentTarget) {}
    visitClassExpression(node: S.ClassExpression) {}
    visitClassDeclaration(node: S.ClassDeclaration) {}
    visitClassElement(node: S.ClassElement) {}
    visitModule(node: S.Module) {}
    visitImport(node: S.Import) {}
    visitImportNamespace(node: S.ImportNamespace) {}
    visitImportSpecifier(node: S.ImportSpecifier) {}
    visitExportAllFrom(node: S.ExportAllFrom) {}
    visitExportFrom(node: S.ExportFrom) {}
    visitExportLocals(node: S.ExportLocals) {}
    visitExport(node: S.Export) {}
    visitExportDefault(node: S.ExportDefault) {}
    visitExportFromSpecifier(node: S.ExportFromSpecifier) {}
    visitExportLocalSpecifier(node: S.ExportLocalSpecifier) {}
    visitEagerMethod(node: S.EagerMethod) {}
    visitSkippableMethod(node: S.SkippableMethod) {}
    visitEagerGetter(node: S.EagerGetter) {}
    visitSkippableGetter(node: S.SkippableGetter) {}
    visitEagerSetter(node: S.EagerSetter) {}
    visitSkippableSetter(node: S.SkippableSetter) {}
    visitDataProperty(node: S.DataProperty) {}
    visitShorthandProperty(node: S.ShorthandProperty) {}
    visitComputedPropertyName(node: S.ComputedPropertyName) {}
    visitLiteralPropertyName(node: S.LiteralPropertyName) {}
    visitLiteralBooleanExpression(node: S.LiteralBooleanExpression) {}
    visitLiteralInfinityExpression(node: S.LiteralInfinityExpression) {}
    visitLiteralNullExpression(node: S.LiteralNullExpression) {}
    visitLiteralNumericExpression(node: S.LiteralNumericExpression) {}
    visitLiteralRegExpExpression(node: S.LiteralRegExpExpression) {}
    visitLiteralStringExpression(node: S.LiteralStringExpression) {}
    visitArrayExpression(node: S.ArrayExpression) {}
    visitEagerArrowExpression(node: S.EagerArrowExpression) {}
    visitSkippableArrowExpression(node: S.SkippableArrowExpression) {}
    visitAssignmentExpression(node: S.AssignmentExpression) {}
    visitBinaryExpression(node: S.BinaryExpression) {}
    visitCallExpression(node: S.CallExpression) {}
    visitCompoundAssignmentExpression(node: S.CompoundAssignmentExpression) {}
    visitComputedMemberExpression(node: S.ComputedMemberExpression) {}
    visitConditionalExpression(node: S.ConditionalExpression) {}
    visitEagerFunctionExpression(node: S.EagerFunctionExpression) {}
    visitSkippableFunctionExpression(node: S.SkippableFunctionExpression) {}
    visitIdentifierExpression(node: S.IdentifierExpression) {}
    visitNewExpression(node: S.NewExpression) {}
    visitNewTargetExpression(node: S.NewTargetExpression) {}
    visitObjectExpression(node: S.ObjectExpression) {}
    visitUnaryExpression(node: S.UnaryExpression) {}
    visitStaticMemberExpression(node: S.StaticMemberExpression) {}
    visitTemplateExpression(node: S.TemplateExpression) {}
    visitThisExpression(node: S.ThisExpression) {}
    visitUpdateExpression(node: S.UpdateExpression) {}
    visitYieldExpression(node: S.YieldExpression) {}
    visitYieldStarExpression(node: S.YieldStarExpression) {}
    visitAwaitExpression(node: S.AwaitExpression) {}
    visitBreakStatement(node: S.BreakStatement) {}
    visitContinueStatement(node: S.ContinueStatement) {}
    visitDebuggerStatement(node: S.DebuggerStatement) {}
    visitDoWhileStatement(node: S.DoWhileStatement) {}
    visitEmptyStatement(node: S.EmptyStatement) {}
    visitExpressionStatement(node: S.ExpressionStatement) {}
    visitForInOfBinding(node: S.ForInOfBinding) {}
    visitForInStatement(node: S.ForInStatement) {}
    visitForOfStatement(node: S.ForOfStatement) {}
    visitForStatement(node: S.ForStatement) {}
    visitIfStatement(node: S.IfStatement) {}
    visitLabelledStatement(node: S.LabelledStatement) {}
    visitReturnStatement(node: S.ReturnStatement) {}
    visitSwitchStatement(node: S.SwitchStatement) {}
    visitSwitchStatementWithDefault(node: S.SwitchStatementWithDefault) {}
    visitThrowStatement(node: S.ThrowStatement) {}
    visitTryCatchStatement(node: S.TryCatchStatement) {}
    visitTryFinallyStatement(node: S.TryFinallyStatement) {}
    visitWhileStatement(node: S.WhileStatement) {}
    visitWithStatement(node: S.WithStatement) {}
    visitBlock(node: S.Block) {}
    visitCatchClause(node: S.CatchClause) {}
    visitDirective(node: S.Directive) {}
    visitFormalParameters(node: S.FormalParameters) {}
    visitFunctionBody(node: S.FunctionBody) {}
    visitEagerFunctionDeclaration(node: S.EagerFunctionDeclaration) {}
    visitSkippableFunctionDeclaration(node: S.SkippableFunctionDeclaration) {}
    visitScript(node: S.Script) {}
    visitSpreadElement(node: S.SpreadElement) {}
    visitSuper(node: S.Super) {}
    visitSwitchCase(node: S.SwitchCase) {}
    visitSwitchDefault(node: S.SwitchDefault) {}
    visitTemplateElement(node: S.TemplateElement) {}
    visitVariableDeclaration(node: S.VariableDeclaration) {}
    visitVariableDeclarator(node: S.VariableDeclarator) {}
}
