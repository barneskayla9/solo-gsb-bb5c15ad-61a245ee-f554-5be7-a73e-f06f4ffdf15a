'use strict';

/* ============================================================
 * 变量清单与赋值编辑的联动规则（浏览器与 Node 测试共用）
 *
 * 浏览器：index.html 先于 app.js 加载本文件，挂载为 window.VarOps；
 * Node：直接 require（UMD 写法，无任何 DOM / 浏览器依赖）。
 * ============================================================ */

/** 判断一个值是否为赋值对象（场景进入赋值 / 选项赋值共用同构） */
function isAssign(a) {
  return !!a && typeof a === 'object' && typeof a.variable === 'string';
}

/** 过滤掉赋值数组中指向 name 的项（返回新数组，不修改入参） */
function pruneAssigns(assigns, name) {
  return (Array.isArray(assigns) ? assigns : []).filter((a) => !(isAssign(a) && a.variable === name));
}

/**
 * 删除变量的联动：从草稿中清除**所有**指向该变量的赋值——
 * 包括每个场景的进入赋值与每个选项的选择时赋值（跨全部场景，
 * 不限于当前打开的场景）。条件文本（选项显示条件 / 场景前置条件）
 * 按既有约定保留，不做改动（分析时仍会提示未声明变量）。
 * 直接就地修改 story 并返回它，保证界面、保存内容与未保存草稿
 * 审计随后读到的是同一份状态。
 */
function removeVariableFromStory(story, name) {
  if (!story || typeof story !== 'object') return story;
  if (Array.isArray(story.variables)) {
    story.variables = story.variables.filter((v) => (typeof v === 'string' ? v : v && v.name) !== name);
  }
  for (const sc of Array.isArray(story.scenes) ? story.scenes : []) {
    if (!sc) continue;
    sc.assigns = pruneAssigns(sc.assigns, name);
    for (const opt of Array.isArray(sc.options) ? sc.options : []) {
      if (opt) opt.assigns = pruneAssigns(opt.assigns, name);
    }
  }
  return story;
}

/**
 * 删除变量时同步清理查询面板的草稿约束：与选项 UID 的处理一致，
 * 指向已删变量的约束行被剔除，空变量名的占位行保留。
 * 返回新数组（不修改入参）。
 */
function pruneConstraints(constraints, name) {
  return (Array.isArray(constraints) ? constraints : [])
    .filter((c) => !c || c.variable !== name);
}

const api = { isAssign, pruneAssigns, removeVariableFromStory, pruneConstraints };

if (typeof module === 'object' && module.exports) {
  module.exports = api;
} else if (typeof window === 'object') {
  window.VarOps = api;
}
