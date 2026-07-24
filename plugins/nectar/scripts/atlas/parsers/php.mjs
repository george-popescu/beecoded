import PhpParser from 'php-parser';

function lineRange(node) {
  return {
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
  };
}

function nodeName(node) {
  if (!node) return null;
  if (typeof node === 'string') return node;
  if (['identifier', 'name', 'variable'].includes(node.kind)) return node.name;
  if (node.kind === 'staticlookup' || node.kind === 'propertylookup' || node.kind === 'nullsafepropertylookup') {
    const owner = nodeName(node.what);
    const member = nodeName(node.offset);
    return owner && member ? `${owner}.${member}` : owner || member;
  }
  return null;
}

function symbolEntry(node, owner = null) {
  if (['class', 'interface', 'trait', 'enum'].includes(node.kind)) {
    const name = nodeName(node.name);
    if (!name) return null;
    return {
      kind: node.kind,
      name,
      ...lineRange(node),
    };
  }
  if (node.kind === 'function') {
    return {
      kind: 'function',
      name: nodeName(node.name),
      ...lineRange(node),
    };
  }
  if (node.kind === 'method' && owner) {
    return {
      kind: 'method',
      name: `${owner}.${nodeName(node.name)}`,
      ...lineRange(node),
    };
  }
  return null;
}

function visit(node, visitor, owner = null, namespace = null) {
  if (!node || typeof node !== 'object') return;
  const nextOwner = ['class', 'interface', 'trait', 'enum'].includes(node.kind)
    ? nodeName(node.name)
    : owner;
  const nextNamespace = node.kind === 'namespace' ? node.name : namespace;
  visitor(node, owner, namespace);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child?.kind) visit(child, visitor, nextOwner, nextNamespace);
      }
    } else if (value?.kind) {
      visit(value, visitor, nextOwner, nextNamespace);
    }
  }
}

function useImport(node) {
  const prefix = node.name ? `${node.name}\\` : '';
  return node.items.map((item) => {
    const source = `${prefix}${item.name}`;
    return {
      source,
      names: [item.alias?.name || source.split('\\').at(-1)],
      ...lineRange(item),
    };
  });
}

function handlerName(argument) {
  if (argument?.kind !== 'array' || argument.items.length < 2) return null;
  const [ownerEntry, methodEntry] = argument.items;
  const owner = nodeName(ownerEntry?.value)?.replace(/\.class$/, '');
  const method = methodEntry?.value?.kind === 'string' ? methodEntry.value.value : null;
  return owner && method ? `${owner}.${method}` : null;
}

const engine = new PhpParser({
  parser: {
    extractDoc: false,
    suppressErrors: false,
  },
  ast: {
    withPositions: true,
  },
});

export function parseFile(file) {
  const ast = engine.parseCode(file.content, file.path);
  const record = {
    path: file.path,
    language: 'php',
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

  visit(ast, (node, owner, namespace) => {
    const symbol = symbolEntry(node, owner);
    if (symbol) record.symbols.push(symbol);
    if (symbol && ['class', 'interface', 'trait', 'enum', 'function'].includes(symbol.kind)) {
      record.exports.push({
        ...symbol,
        qualifiedName: namespace ? `${namespace}\\${symbol.name}` : symbol.name,
      });
    }

    if (node.kind === 'usegroup') {
      record.imports.push(...useImport(node));
    }

    if (node.kind === 'call') {
      const name = nodeName(node.what);
      if (name) {
        record.calls.push({
          name,
          ...lineRange(node),
        });
      }
      if (/^Route\.[A-Za-z]+$/.test(name) && node.arguments[0]?.kind === 'string') {
        record.routeHints.push({
          method: name.split('.').at(-1).toUpperCase(),
          path: node.arguments[0].value,
          handler: handlerName(node.arguments[1]),
          ...lineRange(node),
        });
      }
    }

    if (node.kind === 'new') {
      const name = nodeName(node.what);
      if (name) {
        record.calls.push({
          name,
          ...lineRange(node),
        });
      }
    }

    if (['class', 'interface'].includes(node.kind)) {
      const symbolName = nodeName(node.name);
      if (!symbolName) return;
      const extended = Array.isArray(node.extends)
        ? node.extends
        : node.extends
          ? [node.extends]
          : [];
      for (const target of extended) {
        record.inheritance.push({
          symbol: symbolName,
          relation: 'extends',
          target: nodeName(target),
          ...lineRange(target),
        });
      }
      for (const target of node.implements || []) {
        record.inheritance.push({
          symbol: symbolName,
          relation: 'implements',
          target: nodeName(target),
          ...lineRange(target),
        });
      }
    }
  });

  return record;
}
