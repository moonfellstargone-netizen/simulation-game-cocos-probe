function hasAnyTag(task, tags) {
  if (!tags || tags.length === 0) return false;
  const taskTags = new Set(task.tags ?? []);
  return tags.some((tag) => taskTags.has(tag));
}

function hasAllTags(task, tags) {
  if (!tags || tags.length === 0) return true;
  const taskTags = new Set(task.tags ?? []);
  return tags.every((tag) => taskTags.has(tag));
}

function isExcluded(task, gate) {
  return hasAnyTag(task, gate.excludeTags ?? []);
}

export function resolveGateTasks(gateName, gatePolicy, testRegistry) {
  const gates = gatePolicy.gates ?? {};
  const tests = testRegistry.tests ?? {};
  const visiting = new Set();
  const ordered = [];
  const seen = new Set();

  function addTask(id) {
    if (!tests[id]) throw new Error(`gate references unknown quality task: ${id}`);
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push({ id, ...tests[id] });
  }

  function maybeAddTask(id, task, gate) {
    if (isExcluded(task, gate)) return;
    addTask(id);
  }

  function includeByTags(gate) {
    const includeTagsAny = gate.includeTagsAny ?? gate.includeTags ?? [];
    const includeTagsAll = gate.includeTagsAll ?? [];
    for (const [id, task] of Object.entries(tests)) {
      const matchesAny = includeTagsAny.length === 0 || hasAnyTag(task, includeTagsAny);
      const matchesAll = hasAllTags(task, includeTagsAll);
      if (matchesAny && matchesAll) maybeAddTask(id, task, gate);
    }
  }

  function includeGate(name) {
    const gate = gates[name];
    if (!gate) throw new Error(`unknown quality gate: ${name}`);
    if (gate.reserved) return;
    if (visiting.has(name)) throw new Error(`recursive quality gate include: ${name}`);
    visiting.add(name);
    for (const included of gate.includeGates ?? []) includeGate(included);
    for (const id of gate.includeTests ?? []) {
      const task = tests[id];
      if (!task) throw new Error(`gate references unknown quality task: ${id}`);
      maybeAddTask(id, task, gate);
    }
    if ((gate.includeTagsAny ?? gate.includeTags ?? []).length > 0 || (gate.includeTagsAll ?? []).length > 0) {
      includeByTags(gate);
    }
    visiting.delete(name);
  }

  includeGate(gateName);
  return ordered;
}
