'use strict';

// 变量清单 ↔ 赋值编辑联动自检（node test/varops.js）
// 覆盖：
//   - 删除变量时清除全部场景的进入赋值与选项赋值（跨场景，不限于当前场景）
//   - 条件文本（选项显示条件 / 场景前置条件）按既有约定保留
//   - 其他变量的已有选择与布尔值不丢失；其他未保存编辑（文案 / 目标 / 权重）不动
//   - 新增变量不改动任何既有赋值（下拉候选项由前端就地补齐，由 DOM 层保证）
//   - 路径查询草稿约束中指向已删变量的行被剔除，空占位行保留
//   - 连续增删（删了又加同名变量）后状态一致、幂等
//   - 切换场景 / 重新加载草稿：模型中不再残留指向已删变量的赋值
//   - 联动后的草稿经 PUT /api/stories/:id 保存再经 GET 读回，内容一致
//   - 联动后的草稿送 POST /api/assign-audit：审计不再包含已删变量的赋值（界面 /
//     保存内容 / 未保存草稿审计使用一致状态），且接口请求 / 响应约定不变
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// 隔离数据目录，避免污染开发数据；禁用播种（必须在加载项目模块之前设置）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varops-test-'));
process.env.DATA_DIR = tmpDir;
process.env.SEED_ON_START = 'false';

const VarOps = require('../public/varops');
const app = require('../server');

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); };
const eq = (name, actual, expected) => {
  assert.strictEqual(actual, expected, `${name}（实际 ${JSON.stringify(actual)}）`);
  passed++; console.log(`  ✓ ${name}`);
};

const buildDraft = () => ({
  title: '联动测试',
  description: '',
  startScene: 'a',
  variables: [
    { name: 'x', description: '将被删除' },
    { name: 'y', description: '保留' },
  ],
  scenes: [
    {
      id: 'a', title: '甲', text: '场景甲', precondition: 'y', assigns: [
        { variable: 'x', value: false },
        { variable: 'y', value: true },
      ],
      options: [
        { text: '去乙', condition: 'x && y', target: 'b', weight: 3,
          assigns: [{ variable: 'x', value: true }, { variable: 'y', value: false }] },
        { text: '留甲', condition: '!z', target: 'a',
          assigns: [{ variable: 'x', value: false }] },
      ],
    },
    {
      id: 'b', title: '乙', text: '场景乙', precondition: '', assigns: [
        { variable: 'x', value: true },
      ],
      options: [
        { text: '结束', condition: 'y || x', target: '', assigns: [] },
      ],
    },
  ],
});

// ---------- 删除变量：清除所有指向它的赋值（跨全部场景），其余不动 ----------
console.log('删除变量：清除进入赋值 / 选项赋值并保留条件文本');
const draft = buildDraft();
VarOps.removeVariableFromStory(draft, 'x');

ok('变量清单移除 x', draft.variables.map((v) => v.name).join(',') === 'y');
eq('场景 a 的进入赋值只余 y', draft.scenes[0].assigns.map((a) => a.variable).join(','), 'y');
eq('场景 a 的进入赋值 y 布尔值保留', draft.scenes[0].assigns[0].value, true);
eq('场景 a 选项 1 的赋值只余 y=false',
  draft.scenes[0].options[0].assigns.map((a) => `${a.variable}=${a.value}`).join(','), 'y=false');
eq('场景 a 选项 2 的 x 赋值被清空', draft.scenes[0].options[1].assigns.length, 0);
eq('场景 b（非当前场景）的进入赋值同样被清除', draft.scenes[1].assigns.length, 0);
eq('场景 a 前置条件文本保留（y=true，删除后仍可进入）', draft.scenes[0].precondition, 'y');
eq('场景 a 选项 1 条件文本保留（x 已未声明，会按既有提示告警）', draft.scenes[0].options[0].condition, 'x && y');
eq('场景 a 选项 2 条件文本保留（含未声明 z）', draft.scenes[0].options[1].condition, '!z');
eq('场景 b 选项 1 条件文本保留', draft.scenes[1].options[0].condition, 'y || x');
eq('未保存编辑保留：选项文案', draft.scenes[0].options[0].text, '去乙');
eq('未保存编辑保留：跳转目标', draft.scenes[0].options[0].target, 'b');
eq('未保存编辑保留：权重', draft.scenes[0].options[0].weight, 3);
eq('未保存编辑保留：场景正文', draft.scenes[0].text, '场景甲');

// ---------- 删除不存在的变量：幂等，不改动任何内容 ----------
console.log('幂等：删除不存在 / 再次删除同一变量');
const before = JSON.stringify(draft);
VarOps.removeVariableFromStory(draft, 'x');
VarOps.removeVariableFromStory(draft, 'nope');
eq('重复删除不产生额外变化', JSON.stringify(draft), before);

// ---------- 连续增删：删掉后再加同名变量，不复活旧赋值 ----------
console.log('连续增删：同名变量重新加入后旧赋值不复活');
draft.variables.push({ name: 'x', description: '重新加入' });
ok('重新加入 x 后赋值清单仍为空（旧赋值不复活）',
  draft.scenes.every((s) => s.assigns.length === (s.id === 'a' ? 1 : 0)) &&
  draft.scenes[0].options[0].assigns.length === 1 &&
  draft.scenes[0].options[0].assigns[0].variable === 'y');
// 新变量可以立刻被新赋值引用（模拟编辑器“＋ 赋值”写入）
draft.scenes[1].assigns.push({ variable: 'x', value: true });
VarOps.removeVariableFromStory(draft, 'x');
eq('再次删除时新赋值同样被清除', draft.scenes[1].assigns.length, 0);

// ---------- 路径查询草稿约束联动 ----------
console.log('路径查询约束：删除变量时剔除对应行，空占位行保留');
const constraints = [
  { variable: '', value: true },
  { variable: 'x', value: true },
  { variable: 'y', value: false },
  { variable: 'x', value: false },
];
const pruned = VarOps.pruneConstraints(constraints, 'x');
eq('剔除两行 x 约束后剩两行', pruned.length, 2);
eq('保留空占位行', pruned[0].variable, '');
eq('保留 y 约束及其布尔值', `${pruned[1].variable}=${pruned[1].value}`, 'y=false');
ok('原数组不被修改', constraints.length === 4);

// ---------- 空 / 残缺结构容错 ----------
console.log('容错：空剧情 / 缺字段不抛错');
assert.doesNotThrow(() => VarOps.removeVariableFromStory(null, 'x'));
assert.doesNotThrow(() => VarOps.removeVariableFromStory({}, 'x'));
assert.doesNotThrow(() => VarOps.removeVariableFromStory({ scenes: [null, { options: [null] }] }, 'x'));
assert.doesNotThrow(() => VarOps.pruneConstraints(null, 'x'));
eq('pruneAssigns 对非数组返回空数组', VarOps.pruneAssigns(undefined, 'x').length, 0);
ok('容错用例通过', true);

// ---------- 切换场景等价性：模型中再无任何指向已删变量的赋值 ----------
console.log('切换场景 / 重新加载：遍历全剧情无残留赋值');
const draft2 = buildDraft();
VarOps.removeVariableFromStory(draft2, 'x');
const dangling = [];
for (const s of draft2.scenes) {
  for (const a of s.assigns || []) if (a.variable === 'x') dangling.push(`${s.id}.assigns`);
  for (const o of s.options || []) {
    for (const a of o.assigns || []) if (a.variable === 'x') dangling.push(`${s.id}.option.assigns`);
  }
}
eq('全剧情无指向 x 的残留赋值', dangling.length, 0);

// ---------- HTTP：保存联动后的草稿并读回，再对同一草稿做赋值消费审计 ----------
console.log('HTTP：PUT 保存 → GET 读回 → POST /api/assign-audit 使用一致状态');

const server = app.listen(0, '127.0.0.1');

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const serverAddr = server.address();
    const r = http.request({
      method,
      host: '127.0.0.1',
      port: serverAddr.port,
      path: urlPath,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = null;
        if (raw) { try { data = JSON.parse(raw); } catch (e) { data = raw; } }
        resolve({ status: res.statusCode, body: data });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  // 先创建剧情（服务端规整、补 UID），再模拟“删除变量 x 后保存”
  const created = await req('POST', '/api/stories', buildDraft());
  eq('POST /api/stories 返回 201', created.status, 201);
  const id = created.body.id;

  const savedDraft = buildDraft();
  savedDraft.id = id;
  VarOps.removeVariableFromStory(savedDraft, 'x');
  const put = await req('PUT', `/api/stories/${id}`, savedDraft);
  eq('PUT /api/stories/:id 返回 200', put.status, 200);
  eq('保存后的变量清单只有 y', put.body.variables.map((v) => v.name).join(','), 'y');
  const savedDangling = []
    .concat(put.body.scenes.flatMap((s) => s.assigns.map((a) => [s.id, a.variable])))
    .concat(put.body.scenes.flatMap((s) => s.options.flatMap((o) => o.assigns.map((a) => [s.id, a.variable]))))
    .filter(([, v]) => v === 'x');
  eq('保存内容中无指向 x 的赋值', savedDangling.length, 0);
  ok('保存后选项 UID 等既有字段约定不变',
    put.body.scenes.every((s) => s.options.every((o) => typeof o.uid === 'string')));

  const got = await req('GET', `/api/stories/${id}`);
  eq('GET 读回 200', got.status, 200);
  eq('读回内容与保存响应一致', JSON.stringify(got.body.scenes), JSON.stringify(put.body.scenes));

  // 对“未保存草稿”（与保存内容同构）直接审计
  const auditDraft = await req('POST', '/api/assign-audit', { story: put.body });
  eq('POST /api/assign-audit 返回 200', auditDraft.status, 200);
  eq('审计结论 ok', auditDraft.body.status, 'ok');
  const xDefs = auditDraft.body.assignments.filter((a) => a.variable === 'x');
  eq('草稿审计中不再出现 x 的赋值位置', xDefs.length, 0);
  ok('审计仍逐位置列出 y 的赋值（响应约定不变）',
    auditDraft.body.assignments.every((a) => a.variable === 'y') &&
    auditDraft.body.assignments.length >= 2 &&
    typeof auditDraft.body.summary.total === 'number' &&
    Array.isArray(auditDraft.body.knownVars));

  // 对照：删除前若不联动（保留悬空赋值），审计会把 x 也计入——确认联动确实改变了审计输入
  const rawDraft = buildDraft();
  rawDraft.id = id;
  delete rawDraft.variables; // 等价于“只删变量清单、不清赋值”的旧缺陷草稿
  const auditStale = await req('POST', '/api/assign-audit', { story: rawDraft });
  eq('旧缺陷形态下审计确实包含 x 赋值（对照成立）',
    auditStale.body.assignments.filter((a) => a.variable === 'x').length > 0, true);

  // 已保存剧情接口同样可调用、约定不变
  const auditSaved = await req('GET', `/api/stories/${id}/assign-audit`);
  eq('GET /api/stories/:id/assign-audit 返回 200', auditSaved.status, 200);
  eq('已保存剧情审计也无 x 赋值',
    auditSaved.body.assignments.filter((a) => a.variable === 'x').length, 0);

  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  console.log(`\nvarops 自检通过：${passed} 项`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
