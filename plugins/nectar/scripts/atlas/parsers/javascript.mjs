import path from 'node:path';

import { parse } from '@babel/parser';

function lineRange(node) {
  return {
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
  };
}

function identifierName(node, source = '') {
  if (!node) return null;
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'Super') return 'super';
  if (node.type === 'TSQualifiedName') {
    const left = identifierName(node.left);
    const right = identifierName(node.right);
    return left && right ? `${left}.${right}` : left || right;
  }
  if (
    node.type === 'MemberExpression'
    || node.type === 'OptionalMemberExpression'
    || node.type === 'JSXMemberExpression'
  ) {
    const object = identifierName(node.object, source);
    if (node.computed) {
      const expression = source.slice(node.property.start, node.property.end);
      return object && expression ? `${object}${node.optional ? '?.' : ''}[${expression}]` : null;
    }
    const property = identifierName(node.property, source);
    return object && property ? `${object}.${property}` : object || property;
  }
  return null;
}

function declarationEntries(node, className = null) {
  if (!node) return [];
  const range = lineRange(node);
  if (node.type === 'FunctionDeclaration' && node.id) {
    return [{ kind: 'function', name: node.id.name, ...range }];
  }
  if (node.type === 'ClassDeclaration' && node.id) {
    return [{ kind: 'class', name: node.id.name, ...range }];
  }
  if (node.type === 'TSInterfaceDeclaration') {
    return [{ kind: 'interface', name: node.id.name, ...range }];
  }
  if (node.type === 'TSTypeAliasDeclaration') {
    return [{ kind: 'type', name: node.id.name, ...range }];
  }
  if (node.type === 'TSEnumDeclaration') {
    return [{ kind: 'enum', name: node.id.name, ...range }];
  }
  if (node.type === 'VariableDeclaration') {
    return node.declarations
      .map((declaration) => identifierName(declaration.id))
      .filter(Boolean)
      .map((name) => ({ kind: 'variable', name, ...lineRange(node) }));
  }
  if (
    className
    && ['ClassMethod', 'ClassPrivateMethod', 'ClassProperty', 'ClassPrivateProperty'].includes(
      node.type,
    )
  ) {
    const memberName = identifierName(node.key);
    if (!memberName) return [];
    return [{
      kind: node.type.includes('Method') ? 'method' : 'property',
      name: `${className}.${memberName}`,
      ...range,
    }];
  }
  return [];
}

function importEntry(node) {
  const names = node.specifiers.map((specifier) => {
    if (specifier.type === 'ImportDefaultSpecifier') {
      return `default:${specifier.local.name}`;
    }
    if (specifier.type === 'ImportNamespaceSpecifier') {
      return `*:${specifier.local.name}`;
    }
    const imported = identifierName(specifier.imported);
    return imported === specifier.local.name
      ? imported
      : `${imported}:${specifier.local.name}`;
  });
  return {
    source: node.source.value,
    names,
    ...lineRange(node),
  };
}

function propertyValue(object, propertyName) {
  const property = object.properties.find((candidate) => (
    candidate.type === 'ObjectProperty'
    && identifierName(candidate.key) === propertyName
  ));
  if (!property) return null;
  if (property.value.type === 'StringLiteral') return property.value.value;
  return identifierName(property.value);
}

function visit(node, visitor, className = null, functionDepth = 0) {
  if (!node || typeof node !== 'object') return;
  const nextClassName = node.type === 'ClassDeclaration' && node.id
    ? node.id.name
    : className;
  const nextFunctionDepth = functionDepth + (
    node.type.includes('Function') || node.type.includes('Method') ? 1 : 0
  );
  visitor(node, className, functionDepth);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'errors', 'tokens', 'comments'].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child?.type) visit(child, visitor, nextClassName, nextFunctionDepth);
      }
    } else if (value?.type) {
      visit(value, visitor, nextClassName, nextFunctionDepth);
    }
  }
}

function parserPlugins(extension) {
  const plugins = [];
  if (extension === '.jsx' || extension === '.tsx') plugins.push('jsx');
  if (extension === '.ts' || extension === '.tsx') plugins.push('typescript');
  return plugins;
}

export function parseFile(file) {
  const ast = parse(file.content, {
    sourceType: 'unambiguous',
    sourceFilename: file.path,
    plugins: parserPlugins(path.extname(file.path).toLowerCase()),
  });
  const record = {
    path: file.path,
    language: 'javascript',
    status: 'parsed',
    symbols: [],
    imports: [],
    exports: [],
    calls: [],
    inheritance: [],
    routeHints: [],
    testHints: [],
    failure: null,
  };

  visit(ast.program, (node, className, functionDepth) => {
    if (node.type !== 'VariableDeclaration' || functionDepth === 0) {
      record.symbols.push(...declarationEntries(node, className));
    }

    if (node.type === 'ImportDeclaration') {
      record.imports.push(importEntry(node));
    }

    if (
      (node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
      && identifierName(node.callee, file.content)
    ) {
      record.calls.push({
        name: identifierName(node.callee, file.content),
        ...lineRange(node),
      });
    }
    if (node.type === 'NewExpression' && identifierName(node.callee, file.content)) {
      record.calls.push({
        name: identifierName(node.callee, file.content),
        ...lineRange(node),
      });
    }

    if (node.type === 'ClassDeclaration' && node.id) {
      if (node.superClass) {
        record.inheritance.push({
          symbol: node.id.name,
          relation: 'extends',
          target: identifierName(node.superClass),
          ...lineRange(node.superClass),
        });
      }
      for (const implemented of node.implements || []) {
        record.inheritance.push({
          symbol: node.id.name,
          relation: 'implements',
          target: identifierName(implemented.expression),
          ...lineRange(implemented),
        });
      }
    }

    if (node.type === 'ObjectExpression') {
      const method = propertyValue(node, 'method');
      const routePath = propertyValue(node, 'path');
      if (method && routePath) {
        record.routeHints.push({
          method: method.toUpperCase(),
          path: routePath,
          handler: propertyValue(node, 'handler'),
          ...lineRange(node),
        });
      }
    }
  });

  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration' && statement.type !== 'ExportDefaultDeclaration') {
      continue;
    }
    if (statement.declaration) {
      record.exports.push(...declarationEntries(statement.declaration));
    }
    if (
      statement.type === 'ExportDefaultDeclaration'
      && statement.declaration.type === 'Identifier'
    ) {
      record.exports.push({
        kind: 'reference',
        name: 'default',
        localName: statement.declaration.name,
        ...lineRange(statement),
      });
    }
    for (const specifier of statement.specifiers || []) {
      record.exports.push({
        kind: 'reference',
        name: identifierName(specifier.exported),
        localName: identifierName(specifier.local),
        ...lineRange(specifier),
      });
    }
  }

  return record;
}
