import stylistic from "@stylistic/eslint-plugin";
import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Context = Parameters<NonNullable<Rule["create"]>>[0];
type SourceCode = Context["sourceCode"];
type Node = Parameters<SourceCode["getScope"]>[0];

const padding = stylistic.rules["padding-line-between-statements"] as unknown as Rule &
  Required<Pick<Rule, "create">>;

/** Stylistic's padding-line-between-statements, except where the next statement continues the previous one. */
const statementPadding: Rule = {
  meta: { ...padding.meta, schema: [] },
  create(context) {
    const report: Context["report"] = (descriptor) => {
      if ("node" in descriptor && continuesPrevious(descriptor.node as Node, context.sourceCode))
        return;

      context.report(descriptor);
    };

    return padding.create(
      Object.create(context, {
        options: { value: OPTIONS },
        report: { value: report },
      }) as Context,
    );
  },
};

const OPTIONS = [
  { blankLine: "always", prev: ["const", "let"], next: "*" },
  {
    blankLine: "any",
    prev: ["singleline-const", "singleline-let"],
    next: ["singleline-const", "singleline-let"],
  },
  {
    blankLine: "always",
    prev: "*",
    next: [
      "return",
      "if",
      "block-like",
      "multiline-expression",
      "multiline-const",
      "multiline-let",
    ],
  },
  {
    blankLine: "always",
    prev: ["if", "block-like", "multiline-expression", "multiline-const", "multiline-let"],
    next: "*",
  },
  { blankLine: "any", prev: "*", next: ["case", "default"] },
];

function continuesPrevious(node: Node, sourceCode: SourceCode): boolean {
  const siblings = statementsOf(node.parent);
  const index = siblings.indexOf(node);
  const previous = siblings[index - 1];

  if (!previous) return false;

  if (isThrowGuard(previous) && (isThrowGuard(node) || node.type === "ThrowStatement")) return true;

  if (isSingleLineGuard(previous) && endsGuardChain(node)) return true;

  if (checksDeclaredPresence(previous, node)) return true;

  if (
    node.parent?.type === "BlockStatement" &&
    siblings.length <= SHORT_BLOCK &&
    isSingleLine(previous) &&
    isSingleLine(node)
  )
    return true;

  if (isConditionalStep(previous) && isConditionalStep(node)) return true;

  if (repeatsCall(previous, node)) return true;

  if (relatedDeclarations(previous, node)) return true;

  if (feedsNext(previous, node, sourceCode)) return true;

  return setsUpDeclaration(siblings, index);
}

const SHORT_BLOCK = 3;
const COMPACT_LINES = 8;

// `if (a) clauses.push(…); if (b) clauses.push(…);`
const isConditionalStep = (statement: Node) =>
  statement.type === "IfStatement" && statement.alternate === null && isSingleLine(statement);

// `console.log(…)` or `check(…)` repeated, even when each call wraps.
function repeatsCall(previous: Node, node: Node) {
  const callee = calleePath(previous);

  return (
    callee !== undefined && callee === calleePath(node) && isCompact(previous) && isCompact(node)
  );
}

function calleePath(statement: Node) {
  if (statement.type !== "ExpressionStatement") return;

  const expression =
    statement.expression.type === "AwaitExpression" ||
    statement.expression.type === "YieldExpression"
      ? statement.expression.argument
      : statement.expression;

  return expression?.type === "CallExpression" ? memberPath(expression.callee) : undefined;
}

function memberPath(node: Node): string | undefined {
  if (node.type === "Identifier") return node.name;

  if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier")
    return;

  const object = memberPath(node.object);

  return object === undefined ? undefined : `${object}.${node.property.name}`;
}

// `const end = Math.min(…); chunks.push(push(state, source.subarray(offset, end)))`
function feedsNext(previous: Node, node: Node, sourceCode: SourceCode) {
  if (
    node.type !== "ExpressionStatement" ||
    !isCompact(node) ||
    previous.type !== "VariableDeclaration" ||
    !isSingleLine(previous) ||
    previous.declarations.length !== 1 ||
    previous.declarations[0]?.id.type !== "Identifier" ||
    isServiceLookup(previous.declarations[0].init)
  )
    return false;

  const [variable] = sourceCode.getDeclaredVariables(previous);
  const reads = variable?.references.filter((reference) => !reference.init);

  return (
    reads !== undefined &&
    reads.length > 0 &&
    reads.every(({ identifier }) => readsDirectly(identifier, node))
  );
}

// `yield* Database` or `yield* Billing.Service`, as opposed to `yield* load(…)`.
const isServiceLookup = (init: Node | null | undefined) =>
  init?.type === "YieldExpression" &&
  (init.argument?.type === "Identifier" || init.argument?.type === "MemberExpression");

function readsDirectly(identifier: Node, statement: Node) {
  if (identifier.range[0] < statement.range[0] || identifier.range[1] > statement.range[1])
    return false;

  for (let node = identifier.parent; node && node !== statement; node = node.parent)
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return false;

  return true;
}

const isCompact = (node: Node) => node.loc.end.line - node.loc.start.line < COMPACT_LINES;

function endsGuardChain(node: Node) {
  return (
    isSingleLineGuard(node) ||
    (isSingleLine(node) && (node.type === "ReturnStatement" || node.type === "ThrowStatement"))
  );
}

// `const campaign = await find(…); if (!campaign) throw …`
function checksDeclaredPresence(previous: Node, node: Node) {
  if (node.type !== "IfStatement" || !isSingleLineGuard(node)) return false;

  return isMissingCheck(node.test, declaredNames(previous));
}

function isMissingCheck(test: Node, names: ReadonlyArray<string>): boolean {
  switch (test.type) {
    case "LogicalExpression":
      return (
        test.operator === "||" &&
        isMissingCheck(test.left, names) &&
        isMissingCheck(test.right, names)
      );
    case "UnaryExpression":
      return (
        test.operator === "!" &&
        test.argument.type === "Identifier" &&
        names.includes(test.argument.name)
      );
    case "BinaryExpression": {
      if (test.operator !== "===" && test.operator !== "==") return false;

      const [subject, absent] =
        test.left.type === "Identifier" && names.includes(test.left.name)
          ? [test.left, test.right]
          : [test.right, test.left];

      return subject.type === "Identifier" && names.includes(subject.name) && isAbsentValue(absent);
    }
    default:
      return false;
  }
}

const isAbsentValue = (node: Node) =>
  (node.type === "Literal" && node.value === null) ||
  (node.type === "Identifier" && node.name === "undefined");

// Same kind of value (`Config.option(…)` twice), or derived from the one above (`buckets.reduce(…)`).
function relatedDeclarations(previous: Node, node: Node) {
  if (previous.type !== "VariableDeclaration" || node.type !== "VariableDeclaration") return false;

  const previousHead = valueHead(previous);
  const head = valueHead(node);

  if (previousHead !== undefined && previousHead === head) return true;

  const subject = leadingName(initializerOf(node));

  return subject !== undefined && declaredNames(previous).includes(subject);
}

// `const url = new URL(…); url.searchParams.set(…)`, including further `url.…` statements.
function setsUpDeclaration(siblings: ReadonlyArray<Node>, index: number) {
  const subject = statementSubject(siblings[index]);

  if (!subject) return false;

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const statement = siblings[cursor];

    if (statement?.type === "VariableDeclaration")
      return declaredNames(statement).includes(subject);

    if (statementSubject(statement) !== subject) return false;
  }

  return false;
}

function statementSubject(statement: Node | undefined) {
  if (statement?.type !== "ExpressionStatement") return;

  return accessedName(statement.expression);
}

// The identifier an access chain starts from: `url` in `url.searchParams.set(…)`.
function accessedName(expression: Node): string | undefined {
  let node = expression;

  for (;;)
    switch (node.type) {
      case "Identifier":
        return node.name;
      case "CallExpression":
        node = node.callee;
        break;
      case "MemberExpression":
        node = node.object;
        break;
      case "AssignmentExpression":
        node = node.left;
        break;
      case "UpdateExpression":
        node = node.argument;
        break;
      case "ChainExpression":
      case "TSNonNullExpression":
        node = node.expression;
        break;
      default:
        return;
    }
}

// Like `accessedName`, but also through `await`, `yield*` and the left of an operator.
function leadingName(expression: Node | null | undefined): string | undefined {
  if (!expression) return;

  switch (expression.type) {
    case "AwaitExpression":
    case "YieldExpression":
    case "UnaryExpression":
      return leadingName(expression.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return leadingName(expression.left);
    case "ConditionalExpression":
      return leadingName(expression.test);
    default:
      return accessedName(expression);
  }
}

// `Config.option()` for `yield* Config.option(Config.String("…"))`.
function valueHead(declaration: Node): string | undefined {
  const head = (node: Node | null | undefined): string | undefined => {
    switch (node?.type) {
      case "AwaitExpression":
      case "YieldExpression":
        return head(node.argument);
      case "Identifier":
        return node.name;
      case "MemberExpression":
        return node.property.type === "Identifier" && !node.computed
          ? `${head(node.object)}.${node.property.name}`
          : undefined;
      case "CallExpression":
        return `${head(node.callee)}()`;
      case "NewExpression":
        return `new ${head(node.callee)}`;
      default:
        return;
    }
  };

  return head(initializerOf(declaration));
}

function initializerOf(declaration: Node) {
  if (declaration.type !== "VariableDeclaration") return;

  return declaration.declarations.length === 1 ? declaration.declarations[0]?.init : undefined;
}

function declaredNames(declaration: Node): ReadonlyArray<string> {
  if (declaration.type !== "VariableDeclaration") return [];

  return declaration.declarations.flatMap(({ id }) => bindingNames(id));
}

function bindingNames(pattern: Node | null): ReadonlyArray<string> {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        property.type === "RestElement"
          ? bindingNames(property.argument)
          : bindingNames(property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) => bindingNames(element));
    case "AssignmentPattern":
      return bindingNames(pattern.left);
    case "RestElement":
      return bindingNames(pattern.argument);
    default:
      return [];
  }
}

function statementsOf(parent: Node | null | undefined): ReadonlyArray<Node> {
  if (!parent) return [];

  if (parent.type === "SwitchCase") return parent.consequent;

  return "body" in parent && Array.isArray(parent.body) ? parent.body : [];
}

const isSingleLine = (node: Node) => node.loc.start.line === node.loc.end.line;

const isThrowGuard = (statement: Node) =>
  statement.type === "IfStatement" &&
  statement.alternate === null &&
  statement.consequent.type === "ThrowStatement";

const isSingleLineGuard = (statement: Node) =>
  statement.type === "IfStatement" &&
  statement.alternate === null &&
  isSingleLine(statement) &&
  GUARD_EXITS.has(statement.consequent.type);

const GUARD_EXITS = new Set([
  "ReturnStatement",
  "ThrowStatement",
  "ContinueStatement",
  "BreakStatement",
]);

export default {
  meta: { name: "notus" },
  rules: { "statement-padding": statementPadding },
};
