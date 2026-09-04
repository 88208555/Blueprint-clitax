// Condense all IR edge types into an acyclic implementation dependency graph.
function blueprintComponents(nodes, edges) {
  const ids = nodes.map((node) => node.id).sort();
  const forward = new Map(ids.map((id) => [id, []]));
  const reverse = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    forward.get(edge.fromNodeId).push(edge.toNodeId);
    reverse.get(edge.toNodeId).push(edge.fromNodeId);
  }
  const seen = new Set(), finish = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [{ id, expanded: false }];
    while (stack.length) {
      const current = stack.pop();
      if (current.expanded) { finish.push(current.id); continue; }
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      stack.push({ id: current.id, expanded: true });
      for (const next of forward.get(current.id)) if (!seen.has(next)) stack.push({ id: next, expanded: false });
    }
  }
  const assigned = new Set(), components = [];
  for (const id of finish.reverse()) {
    if (assigned.has(id)) continue;
    const component = [], stack = [id];
    while (stack.length) {
      const current = stack.pop();
      if (assigned.has(current)) continue;
      assigned.add(current); component.push(current);
      for (const next of reverse.get(current)) if (!assigned.has(next)) stack.push(next);
    }
    components.push(component.sort());
  }
  return components.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
}
export function buildBlueprintMachineTasks(blueprint, blueprintSha256, digest) {
  const components = blueprintComponents(blueprint.nodes, blueprint.edges);
  const nodeById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const nodeTaskIds = new Map(), taskIds = new Set();
  const tasks = components.map((nodeRefs) => {
    const taskId = `bp-${digest(JSON.stringify(nodeRefs)).slice(0, 40)}`;
    if (taskIds.has(taskId)) throw new Error("Blueprint task identifier collision.");
    taskIds.add(taskId);
    nodeRefs.forEach((nodeId) => nodeTaskIds.set(nodeId, taskId));
    return { taskId, title: nodeRefs.map((id) => nodeById.get(id).title).join(" / "),
      status: "backlog", owner: null, dependsOn: [], nodeRefs,
      acceptanceRefs: blueprint.acceptanceCriteria.filter((criterion) =>
        criterion.nodeRefs.some((id) => nodeRefs.includes(id))).map((criterion) => criterion.id).sort(),
      internalEdgeRefs: blueprint.edges.filter((edge) => nodeRefs.includes(edge.fromNodeId)
        && nodeRefs.includes(edge.toNodeId)).map((edge) => edge.id).sort() };
  });
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  for (const edge of blueprint.edges) {
    const from = nodeTaskIds.get(edge.fromNodeId), to = nodeTaskIds.get(edge.toNodeId);
    if (from !== to) byId.get(to).dependsOn.push(from);
  }
  for (const task of tasks) task.dependsOn = [...new Set(task.dependsOn)].sort();
  return {
    schemaVersion: "swarm.project/1.0", blueprintId: blueprint.blueprintId, revision: blueprint.revision,
    blueprintSha256, entryTaskId: nodeTaskIds.get(blueprint.entryNodeId),
    dependencyModel: "all-ir-edges-condensed", tasks,
    acceptanceCriteria: blueprint.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.id, statement: criterion.statement, nodeRefs: [...criterion.nodeRefs].sort(),
      taskRefs: [...new Set(criterion.nodeRefs.map((id) => nodeTaskIds.get(id)))].sort(),
    })).sort((left, right) => left.criterionId < right.criterionId ? -1 : left.criterionId > right.criterionId ? 1 : 0),
  };
}
