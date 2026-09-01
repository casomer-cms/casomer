//#region \0rolldown/runtime.js
var e = Object.defineProperty, t = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), n = (t, n) => {
	let r = {};
	for (var i in t) e(r, i, {
		get: t[i],
		enumerable: !0
	});
	return n || e(r, Symbol.toStringTag, { value: "Module" }), r;
};
//#endregion
//#region node_modules/@alpinejs/morph/dist/module.esm.js
function r(e, t, n) {
	m();
	let r = a(n), i = typeof t == "string" ? l(t) : t;
	return window.Alpine && window.Alpine.closestDataStack && !e._x_dataStack && (i._x_dataStack = window.Alpine.closestDataStack(e), i._x_dataStack && window.Alpine.cloneNode(e, i)), r.patch(e, i), e;
}
function i(e, t, n, r = {}) {
	m();
	let i = a(r), o = e.parentNode, s = new d(e, t), c = typeof n == "string" ? (() => {
		let e = document.createElement("div");
		return e.insertAdjacentHTML("beforeend", n), e;
	})() : n, l = document.createComment("[morph-start]"), u = document.createComment("[morph-end]");
	c.insertBefore(l, c.firstChild), c.appendChild(u);
	let f = new d(l, u);
	window.Alpine && window.Alpine.closestDataStack && (c._x_dataStack = window.Alpine.closestDataStack(o), c._x_dataStack && window.Alpine.cloneNode(o, c)), i.patchChildren(s, f);
}
function a(e = {}) {
	let t = (e) => e.getAttribute("key"), n = () => {}, r = {
		key: e.key || t,
		lookahead: e.lookahead || !1,
		updating: e.updating || n,
		updated: e.updated || n,
		removing: e.removing || n,
		removed: e.removed || n,
		adding: e.adding || n,
		added: e.added || n
	};
	return r.patch = function(e, t) {
		if (r.differentElementNamesTypesOrKeys(e, t)) return r.swapElements(e, t);
		let n = !1, i = !1;
		if (!s(r.updating, () => i = !0, (e) => r.skipUntilCondition = e, e, t, () => n = !0)) {
			if (e.nodeType === 1 && window.Alpine && (window.Alpine.cloneNode(e, t), e._x_teleport && t._x_teleport && r.patch(e._x_teleport, t._x_teleport)), u(t)) {
				r.patchNodeValue(e, t), r.updated(e, t);
				return;
			}
			n || r.patchAttributes(e, t), r.updated(e, t), i || r.patchChildren(e, t);
		}
	}, r.differentElementNamesTypesOrKeys = function(e, t) {
		return e.nodeType != t.nodeType || e.nodeName != t.nodeName || r.getKey(e) != r.getKey(t);
	}, r.swapElements = function(e, t) {
		if (o(r.removing, e)) return;
		let n = t.cloneNode(!0);
		o(r.adding, n) || (e.replaceWith(n), r.removed(e), r.added(n));
	}, r.patchNodeValue = function(e, t) {
		let n = t.nodeValue;
		e.nodeValue !== n && (e.nodeValue = n);
	}, r.patchAttributes = function(e, t) {
		if (e._x_transitioning || e._x_isShown && !t._x_isShown || !e._x_isShown && t._x_isShown) return;
		let n = Array.from(e.attributes), r = Array.from(t.attributes);
		for (let r = n.length - 1; r >= 0; r--) {
			let i = n[r].name;
			t.hasAttribute(i) || (i === "open" && e.nodeName === "DIALOG" && e.open ? e.close() : e.removeAttribute(i));
		}
		for (let t = r.length - 1; t >= 0; t--) {
			let n = r[t].name, i = r[t].value;
			e.getAttribute(n) !== i && e.setAttribute(n, i);
		}
	}, r.patchChildren = function(e, t) {
		let n = r.keyToMap(e.children), i = {}, a = f(t), s = f(e);
		for (; a;) {
			h(a, s);
			let c = r.getKey(a), l = r.getKey(s);
			if (r.skipUntilCondition) {
				let n = !s || r.skipUntilCondition(s), i = !a || r.skipUntilCondition(a);
				if (n && i) r.skipUntilCondition = null;
				else {
					n || (s &&= p(e, s)), i || (a &&= p(t, a));
					continue;
				}
			}
			if (!s) {
				if (c && i[c]) {
					let t = i[c];
					e.appendChild(t), s = t, l = r.getKey(s);
				} else {
					if (!o(r.adding, a)) {
						let t = a.cloneNode(!0);
						e.appendChild(t), r.added(t);
					}
					a = p(t, a);
					continue;
				}
			}
			let u = (e) => e && e.nodeType === 8 && e.textContent === "[if BLOCK]><![endif]", f = (e) => e && e.nodeType === 8 && e.textContent === "[if ENDBLOCK]><![endif]";
			if (u(a) && u(s)) {
				let n = 0, i = s;
				for (; s;) {
					let t = p(e, s);
					if (u(t)) n++;
					else if (f(t) && n > 0) n--;
					else if (f(t) && n === 0) {
						s = t;
						break;
					}
					s = t;
				}
				let o = s;
				n = 0;
				let c = a;
				for (; a;) {
					let e = p(t, a);
					if (u(e)) n++;
					else if (f(e) && n > 0) n--;
					else if (f(e) && n === 0) {
						a = e;
						break;
					}
					a = e;
				}
				let l = a, m = new d(i, o), h = new d(c, l);
				r.patchChildren(m, h);
				continue;
			}
			if (s.nodeType === 1 && r.lookahead && !s.isEqualNode(a)) {
				let n = p(t, a), i = !1;
				for (; !i && n;) n.nodeType === 1 && s.isEqualNode(n) && (i = !0, s = r.addNodeBefore(e, a, s), l = r.getKey(s)), n = p(t, n);
			}
			if (c !== l) {
				if (!c && l) {
					i[l] = s, s = r.addNodeBefore(e, a, s), i[l].remove(), s = p(e, s), a = p(t, a);
					continue;
				}
				if (c && !l && n[c] && (s.replaceWith(n[c]), s = n[c], l = r.getKey(s)), c && l) {
					let o = n[c];
					if (o) i[l] = s, s.replaceWith(o), s = o, l = r.getKey(s);
					else {
						i[l] = s, s = r.addNodeBefore(e, a, s), i[l].remove(), s = p(e, s), a = p(t, a);
						continue;
					}
				}
			}
			let m = s && p(e, s);
			r.patch(s, a), s._x_lastRenderedEl && (m = p(e, s._x_lastRenderedEl)), a &&= p(t, a), s = m;
		}
		let c = [];
		for (; s;) o(r.removing, s) || c.push(s), s = p(e, s);
		for (; c.length;) {
			let e = c.shift();
			e.remove(), r.removed(e);
		}
	}, r.getKey = function(e) {
		return e && e.nodeType === 1 && r.key(e);
	}, r.keyToMap = function(e) {
		let t = {};
		for (let n of e) {
			let e = r.getKey(n);
			e && (t[e] = n);
		}
		return t;
	}, r.addNodeBefore = function(e, t, n) {
		if (!o(r.adding, t)) {
			let i = t.cloneNode(!0);
			return e.insertBefore(i, n), r.added(i), i;
		}
		return t;
	}, r;
}
r.step = () => {}, r.log = () => {};
function o(e, ...t) {
	let n = !1;
	return e(...t, () => n = !0), n;
}
function s(e, t, n, ...r) {
	let i = !1;
	return e(...r, () => i = !0, t, n), i;
}
var c = !1;
function l(e) {
	let t = document.createElement("template");
	return t.innerHTML = e, t.content.firstElementChild;
}
function u(e) {
	return e.nodeType === 3 || e.nodeType === 8;
}
var d = class {
	constructor(e, t) {
		this.startComment = e, this.endComment = t;
	}
	get children() {
		let e = [], t = this.startComment.nextSibling;
		for (; t && t !== this.endComment;) e.push(t), t = t.nextSibling;
		return e;
	}
	appendChild(e) {
		this.endComment.before(e);
	}
	get firstChild() {
		let e = this.startComment.nextSibling;
		if (e !== this.endComment) return e;
	}
	nextNode(e) {
		let t = e.nextSibling;
		if (t !== this.endComment) return t;
	}
	insertBefore(e, t) {
		return t.before(e), e;
	}
};
function f(e) {
	return e.firstChild;
}
function p(e, t) {
	let n;
	return n = e instanceof d ? e.nextNode(t) : t.nextSibling, n;
}
function m() {
	if (c) return;
	c = !0;
	let e = Element.prototype.setAttribute, t = document.createElement("div");
	Element.prototype.setAttribute = function(n, r) {
		if (!n.includes("@")) return e.call(this, n, r);
		let i = r.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
		t.innerHTML = `<span ${n}="${i}"></span>`;
		let a = t.firstElementChild.getAttributeNode(n);
		t.firstElementChild.removeAttributeNode(a), this.setAttributeNode(a);
	};
}
function h(e, t) {
	let n = t && t._x_bindings && t._x_bindings.id;
	n && e.setAttribute && (e.setAttribute("id", n), e.id = n);
}
function g(e) {
	e.morph = r, e.morphBetween = i;
}
var _ = g, v = class extends Error {
	position;
	constructor(e, t) {
		super(e), this.name = "ExpressionSyntaxError", this.position = t;
	}
}, y = [
	"==",
	"!=",
	"&&",
	"||"
], b = [
	"(",
	")",
	"[",
	"]",
	",",
	"!"
], x = /[A-Za-z_]/, S = /[A-Za-z0-9_]/;
function C(e) {
	let t = [], n = 0;
	for (; n < e.length;) {
		let r = e[n];
		if (r === " " || r === "	") {
			n += 1;
			continue;
		}
		let i = e.slice(n, n + 2);
		if (y.includes(i)) {
			t.push({
				kind: "punctuation",
				text: i,
				position: n
			}), n += 2;
			continue;
		}
		if (b.includes(r)) {
			t.push({
				kind: "punctuation",
				text: r,
				position: n
			}), n += 1;
			continue;
		}
		if (r === "\"" || r === "'") {
			let i = e.indexOf(r, n + 1);
			if (i === -1) throw new v(`Unclosed string starting at position ${n}. Add a closing ${r} quote.`, n);
			t.push({
				kind: "string",
				value: e.slice(n + 1, i),
				position: n
			}), n = i + 1;
			continue;
		}
		if (/[0-9]/.test(r) || r === "-" && /[0-9]/.test(e[n + 1] ?? "")) {
			let r = /^-?[0-9]+(\.[0-9]+)?/.exec(e.slice(n));
			t.push({
				kind: "number",
				value: Number(r[0]),
				position: n
			}), n += r[0].length;
			continue;
		}
		if (x.test(r)) {
			let r = n + 1;
			for (; r < e.length && S.test(e[r]);) r += 1;
			let i = e.slice(n, r);
			i === "true" || i === "false" ? t.push({
				kind: "boolean",
				value: i === "true",
				position: n
			}) : t.push({
				kind: "identifier",
				text: i,
				position: n
			}), n = r;
			continue;
		}
		throw new v(`Unexpected character "${r}" at position ${n}. The condition language allows field keys, quoted strings, numbers, true, false, ==, !=, in, &&, ||, !, parentheses, and [lists].`, n);
	}
	return t.push({
		kind: "end",
		position: e.length
	}), t;
}
var w = class {
	tokens;
	index = 0;
	constructor(e) {
		this.tokens = e;
	}
	parseExpression() {
		let e = this.parseOr(), t = this.peek();
		if (t.kind !== "end") throw new v(`Unexpected ${T(t)} at position ${t.position}. The expression was already complete.`, t.position);
		return e;
	}
	parseOr() {
		let e = this.parseAnd();
		for (; this.consumePunctuation("||");) e = {
			kind: "or",
			left: e,
			right: this.parseAnd()
		};
		return e;
	}
	parseAnd() {
		let e = this.parseNot();
		for (; this.consumePunctuation("&&");) e = {
			kind: "and",
			left: e,
			right: this.parseNot()
		};
		return e;
	}
	parseNot() {
		return this.consumePunctuation("!") ? {
			kind: "not",
			operand: this.parseNot()
		} : this.parseComparison();
	}
	parseComparison() {
		let e = this.parseOperand();
		return this.consumePunctuation("==") ? {
			kind: "comparison",
			operator: "==",
			left: e,
			right: this.parseOperand()
		} : this.consumePunctuation("!=") ? {
			kind: "comparison",
			operator: "!=",
			left: e,
			right: this.parseOperand()
		} : this.consumeKeyword("in") ? {
			kind: "membership",
			operand: e,
			list: this.parseLiteralList()
		} : {
			kind: "operand",
			operand: e
		};
	}
	parseOperand() {
		let e = this.peek();
		if (e.kind === "identifier") return this.index += 1, {
			kind: "field",
			key: e.text
		};
		if (e.kind === "string" || e.kind === "number" || e.kind === "boolean") return this.index += 1, {
			kind: "literal",
			value: e.value
		};
		if (e.kind === "punctuation" && e.text === "(") {
			this.index += 1;
			let e = this.parseOr();
			return this.expectPunctuation(")"), {
				kind: "group",
				expression: e
			};
		}
		throw new v(`Expected a field key, a literal, or a parenthesized expression at position ${e.position}, but found ${T(e)}.`, e.position);
	}
	parseLiteralList() {
		this.expectPunctuation("[");
		let e = [];
		for (;;) {
			let t = this.peek();
			if (t.kind === "string" || t.kind === "number" || t.kind === "boolean") this.index += 1, e.push(t.value);
			else throw new v(`Lists may contain only literals. Found ${T(t)} at position ${t.position}.`, t.position);
			if (!this.consumePunctuation(",")) return this.expectPunctuation("]"), e;
		}
	}
	peek() {
		return this.tokens[this.index];
	}
	consumePunctuation(e) {
		let t = this.peek();
		return t.kind === "punctuation" && t.text === e && (this.index += 1, !0);
	}
	consumeKeyword(e) {
		let t = this.peek();
		return t.kind === "identifier" && t.text === e && (this.index += 1, !0);
	}
	expectPunctuation(e) {
		let t = this.peek();
		if (t.kind === "punctuation" && t.text === e) {
			this.index += 1;
			return;
		}
		throw new v(`Expected "${e}" at position ${t.position}, but found ${T(t)}.`, t.position);
	}
};
function T(e) {
	switch (e.kind) {
		case "identifier": return `the field key "${e.text}"`;
		case "string": return `the string "${e.value}"`;
		case "number": return `the number ${e.value}`;
		case "boolean": return `the literal ${e.value}`;
		case "punctuation": return `"${e.text}"`;
		case "end": return "the end of the expression";
	}
}
function E(e) {
	return new w(C(e)).parseExpression();
}
var D = Symbol("absent");
function O(e, t) {
	switch (e.kind) {
		case "field": return t[e.key] ?? D;
		case "literal": return e.value;
		case "group": return A(e.expression, t);
	}
}
function k(e) {
	return e === D ? !1 : typeof e == "boolean" ? e : typeof e == "number" ? e !== 0 && !Number.isNaN(e) : e.length > 0;
}
function A(e, t) {
	switch (e.kind) {
		case "or": return A(e.left, t) || A(e.right, t);
		case "and": return A(e.left, t) && A(e.right, t);
		case "not": return !A(e.operand, t);
		case "comparison": {
			let n = O(e.left, t), r = O(e.right, t), i = n !== D && r !== D && n === r;
			return e.operator === "==" ? i : !i;
		}
		case "membership": {
			let n = O(e.operand, t);
			return n !== D && e.list.includes(n);
		}
		case "operand": return k(O(e.operand, t));
	}
}
//#endregion
//#region src/compiler/template.ts
var ee = class extends Error {
	line;
	column;
	constructor(e, t, n) {
		super(`${e} (line ${t}, column ${n})`), this.name = "TemplateSyntaxError", this.line = t, this.column = n;
	}
}, j = /\{\{([\s\S]*?)\}\}/g, M = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
function N(e, t) {
	let n = e.slice(0, t);
	return {
		line: n.split("\n").length,
		column: t - n.lastIndexOf("\n")
	};
}
function te(e) {
	let t = (t, n) => {
		let { line: r, column: i } = N(e, n);
		throw new ee(t, r, i);
	}, n = (e, n) => (M.test(e) || t(`"${e}" is not a field path. Paths are field keys, dotted into object fields where needed, like "title" or "photo.src".`, n), e.split(".")), r = [], i = [], a = r, o = 0;
	for (let r of e.matchAll(j)) {
		r.index > o && a.push({
			kind: "text",
			text: e.slice(o, r.index)
		}), o = r.index + r[0].length;
		let s = r[1].trim(), c = r.index;
		if (s.startsWith("#if")) {
			let e = s.slice(3).trim(), n;
			try {
				n = E(e);
			} catch (r) {
				if (!(r instanceof v)) throw r;
				n = t(`The condition "${e}" does not parse: ${r.message}`, c);
			}
			let r = {
				kind: "if",
				offset: c,
				condition: n,
				source: e,
				outer: a,
				whenTrue: []
			};
			i.push(r), a = r.whenTrue;
			continue;
		}
		if (s === "else") {
			let e = i[i.length - 1];
			if (e === void 0 || e.kind !== "if" || e.whenFalse !== void 0) {
				t("{{else}} belongs inside an {{#if}} block, once.", c);
				continue;
			}
			e.whenFalse = [], a = e.whenFalse;
			continue;
		}
		if (s.startsWith("#each")) {
			let e = {
				kind: "each",
				offset: c,
				path: n(s.slice(5).trim(), c),
				outer: a,
				body: []
			};
			i.push(e), a = e.body;
			continue;
		}
		if (s === "/if" || s === "/each") {
			let e = s.slice(1), n = i.pop();
			if (n === void 0 || n.kind !== e) {
				t(n === void 0 ? `{{${s}}} closes nothing; there is no open block.` : `{{${s}}} does not match the open {{#${n.kind}}} block.`, c);
				continue;
			}
			n.kind === "if" ? n.outer.push({
				kind: "if",
				condition: n.condition,
				source: n.source,
				whenTrue: n.whenTrue,
				whenFalse: n.whenFalse ?? []
			}) : n.outer.push({
				kind: "each",
				path: n.path,
				body: n.body
			}), a = n.outer;
			continue;
		}
		if (s.startsWith("json ")) {
			a.push({
				kind: "interpolation",
				path: n(s.slice(5).trim(), c),
				json: !0
			});
			continue;
		}
		a.push({
			kind: "interpolation",
			path: n(s, c),
			json: !1
		});
	}
	if (i.length > 0) {
		let t = i[i.length - 1], { line: n, column: r } = N(e, t.offset);
		throw new ee(`The {{#${t.kind}}} block is never closed; add {{/${t.kind}}}.`, n, r);
	}
	return o < e.length && a.push({
		kind: "text",
		text: e.slice(o)
	}), r;
}
function P(e) {
	return e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function F(e, t) {
	let n = e.payload, r = e.fields, i;
	for (let e of t) i = r?.[e], n = typeof n == "object" && n && !Array.isArray(n) ? n[e] : void 0, r = i?.type === "group" ? i.fields : void 0;
	return {
		value: n,
		field: i
	};
}
function ne(e) {
	let t = {};
	for (let n of Object.keys(e.fields)) {
		let r = e.payload[n];
		r != null && (t[n] = typeof r == "string" || typeof r == "number" || typeof r == "boolean" ? r : !Array.isArray(r) || r.length > 0);
	}
	return t;
}
function re(e, t, n) {
	for (let r of e) switch (r.kind) {
		case "text":
			n.push(r.text);
			continue;
		case "interpolation": {
			let { value: e, field: i } = F(t, r.path);
			if (e == null) continue;
			if (r.json) {
				n.push(P(JSON.stringify(e)));
				continue;
			}
			if (typeof e != "string" && typeof e != "number" && typeof e != "boolean") continue;
			let a = String(e);
			n.push(i?.type === "markdown" ? a : P(a));
			continue;
		}
		case "if":
			re(A(r.condition, ne(t)) ? r.whenTrue : r.whenFalse, t, n);
			continue;
		case "each": {
			let { value: e, field: i } = F(t, r.path);
			if (!Array.isArray(e) || i?.type !== "list") continue;
			for (let t of e) re(r.body, {
				payload: t,
				fields: i.fields ?? {}
			}, n);
			continue;
		}
	}
}
function ie(e, t, n) {
	let r = [];
	return re(e, {
		payload: t,
		fields: n
	}, r), r.join("");
}
(/* @__PURE__ */ t(((e, t) => {
	t.exports = {};
})))();
function ae(e) {
	if (e != null) return typeof e == "string" || typeof e == "number" || typeof e == "boolean" ? e : !Array.isArray(e) || e.length > 0;
}
function oe(e, t, n) {
	let r = t[n];
	return r === void 0 ? e.defaultValue : r;
}
function se(e, t) {
	let n = Object.entries(e), r = /* @__PURE__ */ new Map();
	for (let [e, i] of n) r.set(e, oe(i, t, e));
	let i = /* @__PURE__ */ new Set(), a = !0;
	for (; a;) {
		a = !1;
		let e = {};
		for (let [t] of n) e[t] = i.has(t) ? void 0 : ae(r.get(t));
		for (let [t, r] of n) r.showWhen === void 0 || i.has(t) || A(r.showWhen.expression, e) || (i.add(t), a = !0);
	}
	let o = {};
	for (let [e, t] of n) {
		if (i.has(e)) continue;
		let n = r.get(e);
		if (n != null) {
			if (t.type === "list" && Array.isArray(n)) {
				o[e] = n.filter((e) => typeof e == "object" && !!e && !Array.isArray(e)).map((e) => se(t.fields ?? {}, e));
				continue;
			}
			if (t.type === "group" && typeof n == "object" && !Array.isArray(n)) {
				o[e] = se(t.fields ?? {}, n);
				continue;
			}
			o[e] = n;
		}
	}
	return o;
}
//#endregion
//#region node_modules/mdast-util-to-string/lib/index.js
var ce = {};
function le(e, t) {
	let n = t || ce;
	return ue(e, typeof n.includeImageAlt != "boolean" || n.includeImageAlt, typeof n.includeHtml != "boolean" || n.includeHtml);
}
function ue(e, t, n) {
	if (fe(e)) {
		if ("value" in e) return e.type === "html" && !n ? "" : e.value;
		if (t && "alt" in e && e.alt) return e.alt;
		if ("children" in e) return de(e.children, t, n);
	}
	return Array.isArray(e) ? de(e, t, n) : "";
}
function de(e, t, n) {
	let r = [], i = -1;
	for (; ++i < e.length;) r[i] = ue(e[i], t, n);
	return r.join("");
}
function fe(e) {
	return !!(e && typeof e == "object");
}
//#endregion
//#region node_modules/decode-named-character-reference/index.dom.js
var pe = document.createElement("i");
function me(e) {
	let t = "&" + e + ";";
	pe.innerHTML = t;
	let n = pe.textContent;
	return n.charCodeAt(n.length - 1) === 59 && e !== "semi" ? !1 : n !== t && n;
}
//#endregion
//#region node_modules/micromark-util-chunked/index.js
function I(e, t, n, r) {
	let i = e.length, a = 0, o;
	if (t = t < 0 ? -t > i ? 0 : i + t : t > i ? i : t, n = n > 0 ? n : 0, r.length < 1e4) o = Array.from(r), o.unshift(t, n), e.splice(...o);
	else for (n && e.splice(t, n); a < r.length;) o = r.slice(a, a + 1e4), o.unshift(t, 0), e.splice(...o), a += 1e4, t += 1e4;
}
function L(e, t) {
	return e.length > 0 ? (I(e, e.length, 0, t), e) : t;
}
//#endregion
//#region node_modules/micromark-util-combine-extensions/index.js
var he = {}.hasOwnProperty;
function ge(e) {
	let t = {}, n = -1;
	for (; ++n < e.length;) _e(t, e[n]);
	return t;
}
function _e(e, t) {
	let n;
	for (n in t) {
		let r = (he.call(e, n) ? e[n] : void 0) || (e[n] = {}), i = t[n], a;
		if (i) for (a in i) {
			he.call(r, a) || (r[a] = []);
			let e = i[a];
			ve(r[a], Array.isArray(e) ? e : e ? [e] : []);
		}
	}
}
function ve(e, t) {
	let n = -1, r = [];
	for (; ++n < t.length;) (t[n].add === "after" ? e : r).push(t[n]);
	I(e, 0, 0, r);
}
//#endregion
//#region node_modules/micromark-util-decode-numeric-character-reference/index.js
function ye(e, t) {
	let n = Number.parseInt(e, t);
	return n < 9 || n === 11 || n > 13 && n < 32 || n > 126 && n < 160 || n > 55295 && n < 57344 || n > 64975 && n < 65008 || (n & 65535) == 65535 || (n & 65535) == 65534 || n > 1114111 ? "�" : String.fromCodePoint(n);
}
//#endregion
//#region node_modules/micromark-util-normalize-identifier/index.js
function R(e) {
	return e.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
//#endregion
//#region node_modules/micromark-util-character/index.js
var z = G(/[A-Za-z]/), B = G(/[\dA-Za-z]/), be = G(/[#-'*+\--9=?A-Z^-~]/);
function xe(e) {
	return e !== null && (e < 32 || e === 127);
}
var Se = G(/\d/), Ce = G(/[\dA-Fa-f]/), we = G(/[!-/:-@[-`{-~]/);
function V(e) {
	return e !== null && e < -2;
}
function H(e) {
	return e !== null && (e < 0 || e === 32);
}
function U(e) {
	return e === -2 || e === -1 || e === 32;
}
var Te = G(/\p{P}|\p{S}/u), W = G(/\s/);
function G(e) {
	return t;
	function t(t) {
		return t !== null && t > -1 && e.test(String.fromCharCode(t));
	}
}
//#endregion
//#region node_modules/micromark-factory-space/index.js
function K(e, t, n, r) {
	let i = r ? r - 1 : Infinity, a = 0;
	return o;
	function o(r) {
		return U(r) ? (e.enter(n), s(r)) : t(r);
	}
	function s(r) {
		return U(r) && a++ < i ? (e.consume(r), s) : (e.exit(n), t(r));
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/content.js
var Ee = { tokenize: De };
function De(e) {
	let t = e.attempt(this.parser.constructs.contentInitial, r, i), n;
	return t;
	function r(n) {
		if (n === null) {
			e.consume(n);
			return;
		}
		return e.enter("lineEnding"), e.consume(n), e.exit("lineEnding"), K(e, t, "linePrefix");
	}
	function i(t) {
		return e.enter("paragraph"), a(t);
	}
	function a(t) {
		let r = e.enter("chunkText", {
			contentType: "text",
			previous: n
		});
		return n && (n.next = r), n = r, o(t);
	}
	function o(t) {
		if (t === null) {
			e.exit("chunkText"), e.exit("paragraph"), e.consume(t);
			return;
		}
		return V(t) ? (e.consume(t), e.exit("chunkText"), a) : (e.consume(t), o);
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/document.js
var Oe = { tokenize: Ae }, ke = { tokenize: je };
function Ae(e) {
	let t = this, n = [], r = 0, i, a, o;
	return s;
	function s(i) {
		if (r < n.length) {
			let a = n[r];
			return t.containerState = a[1], e.attempt(a[0].continuation, c, l)(i);
		}
		return l(i);
	}
	function c(e) {
		if (r++, t.containerState._closeFlow) {
			t.containerState._closeFlow = void 0, i && v();
			let n = t.events.length, a = n, o;
			for (; a--;) if (t.events[a][0] === "exit" && t.events[a][1].type === "chunkFlow") {
				o = t.events[a][1].end;
				break;
			}
			_(r);
			let s = n;
			for (; s < t.events.length;) t.events[s][1].end = { ...o }, s++;
			return I(t.events, a + 1, 0, t.events.slice(n)), t.events.length = s, l(e);
		}
		return s(e);
	}
	function l(a) {
		if (r === n.length) {
			if (!i) return f(a);
			if (i.currentConstruct && i.currentConstruct.concrete) return m(a);
			t.interrupt = !!(i.currentConstruct && !i._gfmTableDynamicInterruptHack);
		}
		return t.containerState = {}, e.check(ke, u, d)(a);
	}
	function u(e) {
		return i && v(), _(r), f(e);
	}
	function d(e) {
		return t.parser.lazy[t.now().line] = r !== n.length, o = t.now().offset, m(e);
	}
	function f(n) {
		return t.containerState = {}, e.attempt(ke, p, m)(n);
	}
	function p(e) {
		return r++, n.push([t.currentConstruct, t.containerState]), f(e);
	}
	function m(n) {
		if (n === null) {
			i && v(), _(0), e.consume(n);
			return;
		}
		return i ||= t.parser.flow(t.now()), e.enter("chunkFlow", {
			_tokenizer: i,
			contentType: "flow",
			previous: a
		}), h(n);
	}
	function h(n) {
		if (n === null) {
			g(e.exit("chunkFlow"), !0), _(0), e.consume(n);
			return;
		}
		return V(n) ? (e.consume(n), g(e.exit("chunkFlow")), r = 0, t.interrupt = void 0, s) : (e.consume(n), h);
	}
	function g(e, n) {
		let s = t.sliceStream(e);
		if (n && s.push(null), e.previous = a, a && (a.next = e), a = e, i.defineSkip(e.start), i.write(s), t.parser.lazy[e.start.line]) {
			let e = i.events.length;
			for (; e--;) if (i.events[e][1].start.offset < o && (!i.events[e][1].end || i.events[e][1].end.offset > o)) return;
			let n = t.events.length, a = n, s, c;
			for (; a--;) if (t.events[a][0] === "exit" && t.events[a][1].type === "chunkFlow") {
				if (s) {
					c = t.events[a][1].end;
					break;
				}
				s = !0;
			}
			for (_(r), e = n; e < t.events.length;) t.events[e][1].end = { ...c }, e++;
			I(t.events, a + 1, 0, t.events.slice(n)), t.events.length = e;
		}
	}
	function _(r) {
		let i = n.length;
		for (; i-- > r;) {
			let r = n[i];
			t.containerState = r[1], r[0].exit.call(t, e);
		}
		n.length = r;
	}
	function v() {
		i.write([null]), a = void 0, i = void 0, t.containerState._closeFlow = void 0;
	}
}
function je(e, t, n) {
	return K(e, e.attempt(this.parser.constructs.document, t, n), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
//#endregion
//#region node_modules/micromark-util-classify-character/index.js
function Me(e) {
	if (e === null || H(e) || W(e)) return 1;
	if (Te(e)) return 2;
}
//#endregion
//#region node_modules/micromark-util-resolve-all/index.js
function Ne(e, t, n) {
	let r = [], i = -1;
	for (; ++i < e.length;) {
		let a = e[i].resolveAll;
		a && !r.includes(a) && (t = a(t, n), r.push(a));
	}
	return t;
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/attention.js
var Pe = {
	name: "attention",
	resolveAll: Fe,
	tokenize: Ie
};
function Fe(e, t) {
	let n = -1, r, i, a, o, s, c, l, u;
	for (; ++n < e.length;) if (e[n][0] === "enter" && e[n][1].type === "attentionSequence" && e[n][1]._close) {
		for (r = n; r--;) if (e[r][0] === "exit" && e[r][1].type === "attentionSequence" && e[r][1]._open && t.sliceSerialize(e[r][1]).charCodeAt(0) === t.sliceSerialize(e[n][1]).charCodeAt(0)) {
			if ((e[r][1]._close || e[n][1]._open) && (e[n][1].end.offset - e[n][1].start.offset) % 3 && !((e[r][1].end.offset - e[r][1].start.offset + e[n][1].end.offset - e[n][1].start.offset) % 3)) continue;
			c = e[r][1].end.offset - e[r][1].start.offset > 1 && e[n][1].end.offset - e[n][1].start.offset > 1 ? 2 : 1;
			let d = { ...e[r][1].end }, f = { ...e[n][1].start };
			Le(d, -c), Le(f, c), o = {
				type: c > 1 ? "strongSequence" : "emphasisSequence",
				start: d,
				end: { ...e[r][1].end }
			}, s = {
				type: c > 1 ? "strongSequence" : "emphasisSequence",
				start: { ...e[n][1].start },
				end: f
			}, a = {
				type: c > 1 ? "strongText" : "emphasisText",
				start: { ...e[r][1].end },
				end: { ...e[n][1].start }
			}, i = {
				type: c > 1 ? "strong" : "emphasis",
				start: { ...o.start },
				end: { ...s.end }
			}, e[r][1].end = { ...o.start }, e[n][1].start = { ...s.end }, l = [], e[r][1].end.offset - e[r][1].start.offset && (l = L(l, [[
				"enter",
				e[r][1],
				t
			], [
				"exit",
				e[r][1],
				t
			]])), l = L(l, [
				[
					"enter",
					i,
					t
				],
				[
					"enter",
					o,
					t
				],
				[
					"exit",
					o,
					t
				],
				[
					"enter",
					a,
					t
				]
			]), l = L(l, Ne(t.parser.constructs.insideSpan.null, e.slice(r + 1, n), t)), l = L(l, [
				[
					"exit",
					a,
					t
				],
				[
					"enter",
					s,
					t
				],
				[
					"exit",
					s,
					t
				],
				[
					"exit",
					i,
					t
				]
			]), e[n][1].end.offset - e[n][1].start.offset ? (u = 2, l = L(l, [[
				"enter",
				e[n][1],
				t
			], [
				"exit",
				e[n][1],
				t
			]])) : u = 0, I(e, r - 1, n - r + 3, l), n = r + l.length - u - 2;
			break;
		}
	}
	for (n = -1; ++n < e.length;) e[n][1].type === "attentionSequence" && (e[n][1].type = "data");
	return e;
}
function Ie(e, t) {
	let n = this.parser.constructs.attentionMarkers.null, r = this.previous, i = Me(r), a;
	return o;
	function o(t) {
		return a = t, e.enter("attentionSequence"), s(t);
	}
	function s(o) {
		if (o === a) return e.consume(o), s;
		let c = e.exit("attentionSequence"), l = Me(o), u = !l || l === 2 && i || n.includes(o), d = !i || i === 2 && l || n.includes(r);
		return c._open = !!(a === 42 ? u : u && (i || !d)), c._close = !!(a === 42 ? d : d && (l || !u)), t(o);
	}
}
function Le(e, t) {
	e.column += t, e.offset += t, e._bufferIndex += t;
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/autolink.js
var Re = {
	name: "autolink",
	tokenize: ze
};
function ze(e, t, n) {
	let r = 0;
	return i;
	function i(t) {
		return e.enter("autolink"), e.enter("autolinkMarker"), e.consume(t), e.exit("autolinkMarker"), e.enter("autolinkProtocol"), a;
	}
	function a(t) {
		return z(t) ? (e.consume(t), o) : t === 64 ? n(t) : l(t);
	}
	function o(e) {
		return e === 43 || e === 45 || e === 46 || B(e) ? (r = 1, s(e)) : l(e);
	}
	function s(t) {
		return t === 58 ? (e.consume(t), r = 0, c) : (t === 43 || t === 45 || t === 46 || B(t)) && r++ < 32 ? (e.consume(t), s) : (r = 0, l(t));
	}
	function c(r) {
		return r === 62 ? (e.exit("autolinkProtocol"), e.enter("autolinkMarker"), e.consume(r), e.exit("autolinkMarker"), e.exit("autolink"), t) : r === null || r === 32 || r === 60 || xe(r) ? n(r) : (e.consume(r), c);
	}
	function l(t) {
		return t === 64 ? (e.consume(t), u) : be(t) ? (e.consume(t), l) : n(t);
	}
	function u(e) {
		return B(e) ? d(e) : n(e);
	}
	function d(n) {
		return n === 46 ? (e.consume(n), r = 0, u) : n === 62 ? (e.exit("autolinkProtocol").type = "autolinkEmail", e.enter("autolinkMarker"), e.consume(n), e.exit("autolinkMarker"), e.exit("autolink"), t) : f(n);
	}
	function f(t) {
		if ((t === 45 || B(t)) && r++ < 63) {
			let n = t === 45 ? f : d;
			return e.consume(t), n;
		}
		return n(t);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/blank-line.js
var Be = {
	partial: !0,
	tokenize: Ve
};
function Ve(e, t, n) {
	return r;
	function r(t) {
		return U(t) ? K(e, i, "linePrefix")(t) : i(t);
	}
	function i(e) {
		return e === null || V(e) ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/block-quote.js
var He = {
	continuation: { tokenize: We },
	exit: Ge,
	name: "blockQuote",
	tokenize: Ue
};
function Ue(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		if (t === 62) {
			let n = r.containerState;
			return n.open ||= (e.enter("blockQuote", { _container: !0 }), !0), e.enter("blockQuotePrefix"), e.enter("blockQuoteMarker"), e.consume(t), e.exit("blockQuoteMarker"), a;
		}
		return n(t);
	}
	function a(n) {
		return U(n) ? (e.enter("blockQuotePrefixWhitespace"), e.consume(n), e.exit("blockQuotePrefixWhitespace"), e.exit("blockQuotePrefix"), t) : (e.exit("blockQuotePrefix"), t(n));
	}
}
function We(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return U(t) ? K(e, a, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : a(t);
	}
	function a(r) {
		return e.attempt(He, t, n)(r);
	}
}
function Ge(e) {
	e.exit("blockQuote");
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/character-escape.js
var Ke = {
	name: "characterEscape",
	tokenize: qe
};
function qe(e, t, n) {
	return r;
	function r(t) {
		return e.enter("characterEscape"), e.enter("escapeMarker"), e.consume(t), e.exit("escapeMarker"), i;
	}
	function i(r) {
		return we(r) ? (e.enter("characterEscapeValue"), e.consume(r), e.exit("characterEscapeValue"), e.exit("characterEscape"), t) : n(r);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/character-reference.js
var Je = {
	name: "characterReference",
	tokenize: Ye
};
function Ye(e, t, n) {
	let r = this, i = 0, a, o;
	return s;
	function s(t) {
		return e.enter("characterReference"), e.enter("characterReferenceMarker"), e.consume(t), e.exit("characterReferenceMarker"), c;
	}
	function c(t) {
		return t === 35 ? (e.enter("characterReferenceMarkerNumeric"), e.consume(t), e.exit("characterReferenceMarkerNumeric"), l) : (e.enter("characterReferenceValue"), a = 31, o = B, u(t));
	}
	function l(t) {
		return t === 88 || t === 120 ? (e.enter("characterReferenceMarkerHexadecimal"), e.consume(t), e.exit("characterReferenceMarkerHexadecimal"), e.enter("characterReferenceValue"), a = 6, o = Ce, u) : (e.enter("characterReferenceValue"), a = 7, o = Se, u(t));
	}
	function u(s) {
		if (s === 59 && i) {
			let i = e.exit("characterReferenceValue");
			return o === B && !me(r.sliceSerialize(i)) ? n(s) : (e.enter("characterReferenceMarker"), e.consume(s), e.exit("characterReferenceMarker"), e.exit("characterReference"), t);
		}
		return o(s) && i++ < a ? (e.consume(s), u) : n(s);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/code-fenced.js
var Xe = {
	partial: !0,
	tokenize: $e
}, Ze = {
	concrete: !0,
	name: "codeFenced",
	tokenize: Qe
};
function Qe(e, t, n) {
	let r = this, i = {
		partial: !0,
		tokenize: x
	}, a = 0, o = 0, s;
	return c;
	function c(e) {
		return l(e);
	}
	function l(t) {
		let n = r.events[r.events.length - 1];
		return a = n && n[1].type === "linePrefix" ? n[2].sliceSerialize(n[1], !0).length : 0, s = t, e.enter("codeFenced"), e.enter("codeFencedFence"), e.enter("codeFencedFenceSequence"), u(t);
	}
	function u(t) {
		return t === s ? (o++, e.consume(t), u) : o < 3 ? n(t) : (e.exit("codeFencedFenceSequence"), U(t) ? K(e, d, "whitespace")(t) : d(t));
	}
	function d(n) {
		return n === null || V(n) ? (e.exit("codeFencedFence"), r.interrupt ? t(n) : e.check(Xe, h, b)(n)) : (e.enter("codeFencedFenceInfo"), e.enter("chunkString", { contentType: "string" }), f(n));
	}
	function f(t) {
		return t === null || V(t) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), d(t)) : U(t) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), K(e, p, "whitespace")(t)) : t === 96 && t === s ? n(t) : (e.consume(t), f);
	}
	function p(t) {
		return t === null || V(t) ? d(t) : (e.enter("codeFencedFenceMeta"), e.enter("chunkString", { contentType: "string" }), m(t));
	}
	function m(t) {
		return t === null || V(t) ? (e.exit("chunkString"), e.exit("codeFencedFenceMeta"), d(t)) : t === 96 && t === s ? n(t) : (e.consume(t), m);
	}
	function h(t) {
		return e.attempt(i, b, g)(t);
	}
	function g(t) {
		return e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), _;
	}
	function _(t) {
		return a > 0 && U(t) ? K(e, v, "linePrefix", a + 1)(t) : v(t);
	}
	function v(t) {
		return t === null || V(t) ? e.check(Xe, h, b)(t) : (e.enter("codeFlowValue"), y(t));
	}
	function y(t) {
		return t === null || V(t) ? (e.exit("codeFlowValue"), v(t)) : (e.consume(t), y);
	}
	function b(n) {
		return e.exit("codeFenced"), t(n);
	}
	function x(e, t, n) {
		let i = 0;
		return a;
		function a(t) {
			return e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), c;
		}
		function c(t) {
			return e.enter("codeFencedFence"), U(t) ? K(e, l, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : l(t);
		}
		function l(t) {
			return t === s ? (e.enter("codeFencedFenceSequence"), u(t)) : n(t);
		}
		function u(t) {
			return t === s ? (i++, e.consume(t), u) : i >= o ? (e.exit("codeFencedFenceSequence"), U(t) ? K(e, d, "whitespace")(t) : d(t)) : n(t);
		}
		function d(r) {
			return r === null || V(r) ? (e.exit("codeFencedFence"), t(r)) : n(r);
		}
	}
}
function $e(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return t === null ? n(t) : (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), a);
	}
	function a(e) {
		return r.parser.lazy[r.now().line] ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/code-indented.js
var et = {
	name: "codeIndented",
	tokenize: nt
}, tt = {
	partial: !0,
	tokenize: rt
};
function nt(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.enter("codeIndented"), K(e, a, "linePrefix", 5)(t);
	}
	function a(e) {
		let t = r.events[r.events.length - 1];
		return t && t[1].type === "linePrefix" && t[2].sliceSerialize(t[1], !0).length >= 4 ? o(e) : n(e);
	}
	function o(t) {
		return t === null ? c(t) : V(t) ? e.attempt(tt, o, c)(t) : (e.enter("codeFlowValue"), s(t));
	}
	function s(t) {
		return t === null || V(t) ? (e.exit("codeFlowValue"), o(t)) : (e.consume(t), s);
	}
	function c(n) {
		return e.exit("codeIndented"), t(n);
	}
}
function rt(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return r.parser.lazy[r.now().line] ? n(t) : V(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), i) : K(e, a, "linePrefix", 5)(t);
	}
	function a(e) {
		let a = r.events[r.events.length - 1];
		return a && a[1].type === "linePrefix" && a[2].sliceSerialize(a[1], !0).length >= 4 ? t(e) : V(e) ? i(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/code-text.js
var it = {
	name: "codeText",
	previous: ot,
	resolve: at,
	tokenize: st
};
function at(e) {
	let t = e.length - 4, n = 3, r, i;
	if ((e[n][1].type === "lineEnding" || e[n][1].type === "space") && (e[t][1].type === "lineEnding" || e[t][1].type === "space")) {
		for (r = n; ++r < t;) if (e[r][1].type === "codeTextData") {
			e[n][1].type = "codeTextPadding", e[t][1].type = "codeTextPadding", n += 2, t -= 2;
			break;
		}
	}
	for (r = n - 1, t++; ++r <= t;) i === void 0 ? r !== t && e[r][1].type !== "lineEnding" && (i = r) : (r === t || e[r][1].type === "lineEnding") && (e[i][1].type = "codeTextData", r !== i + 2 && (e[i][1].end = e[r - 1][1].end, e.splice(i + 2, r - i - 2), t -= r - i - 2, r = i + 2), i = void 0);
	return e;
}
function ot(e) {
	return e !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
function st(e, t, n) {
	let r = 0, i, a;
	return o;
	function o(t) {
		return e.enter("codeText"), e.enter("codeTextSequence"), s(t);
	}
	function s(t) {
		return t === 96 ? (e.consume(t), r++, s) : (e.exit("codeTextSequence"), c(t));
	}
	function c(t) {
		return t === null ? n(t) : t === 32 ? (e.enter("space"), e.consume(t), e.exit("space"), c) : t === 96 ? (a = e.enter("codeTextSequence"), i = 0, u(t)) : V(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), c) : (e.enter("codeTextData"), l(t));
	}
	function l(t) {
		return t === null || t === 32 || t === 96 || V(t) ? (e.exit("codeTextData"), c(t)) : (e.consume(t), l);
	}
	function u(n) {
		return n === 96 ? (e.consume(n), i++, u) : i === r ? (e.exit("codeTextSequence"), e.exit("codeText"), t(n)) : (a.type = "codeTextData", l(n));
	}
}
//#endregion
//#region node_modules/micromark-util-subtokenize/lib/splice-buffer.js
var ct = class {
	constructor(e) {
		this.left = e ? [...e] : [], this.right = [];
	}
	get(e) {
		if (e < 0 || e >= this.left.length + this.right.length) throw RangeError("Cannot access index `" + e + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
		return e < this.left.length ? this.left[e] : this.right[this.right.length - e + this.left.length - 1];
	}
	get length() {
		return this.left.length + this.right.length;
	}
	shift() {
		return this.setCursor(0), this.right.pop();
	}
	slice(e, t) {
		let n = t ?? Infinity;
		return n < this.left.length ? this.left.slice(e, n) : e > this.left.length ? this.right.slice(this.right.length - n + this.left.length, this.right.length - e + this.left.length).reverse() : this.left.slice(e).concat(this.right.slice(this.right.length - n + this.left.length).reverse());
	}
	splice(e, t, n) {
		let r = t || 0;
		this.setCursor(Math.trunc(e));
		let i = this.right.splice(this.right.length - r, Infinity);
		return n && lt(this.left, n), i.reverse();
	}
	pop() {
		return this.setCursor(Infinity), this.left.pop();
	}
	push(e) {
		this.setCursor(Infinity), this.left.push(e);
	}
	pushMany(e) {
		this.setCursor(Infinity), lt(this.left, e);
	}
	unshift(e) {
		this.setCursor(0), this.right.push(e);
	}
	unshiftMany(e) {
		this.setCursor(0), lt(this.right, e.reverse());
	}
	setCursor(e) {
		if (!(e === this.left.length || e > this.left.length && this.right.length === 0 || e < 0 && this.left.length === 0)) {
			if (e < this.left.length) {
				let t = this.left.splice(e, Infinity);
				lt(this.right, t.reverse());
			} else {
				let t = this.right.splice(this.left.length + this.right.length - e, Infinity);
				lt(this.left, t.reverse());
			}
		}
	}
};
function lt(e, t) {
	let n = 0;
	if (t.length < 1e4) e.push(...t);
	else for (; n < t.length;) e.push(...t.slice(n, n + 1e4)), n += 1e4;
}
//#endregion
//#region node_modules/micromark-util-subtokenize/index.js
function ut(e) {
	let t = {}, n = -1, r, i, a, o, s, c, l, u = new ct(e);
	for (; ++n < u.length;) {
		for (; n in t;) n = t[n];
		if (r = u.get(n), n && r[1].type === "chunkFlow" && u.get(n - 1)[1].type === "listItemPrefix" && (c = r[1]._tokenizer.events, a = 0, a < c.length && c[a][1].type === "lineEndingBlank" && (a += 2), a < c.length && c[a][1].type === "content")) for (; ++a < c.length && c[a][1].type !== "content";) c[a][1].type === "chunkText" && (c[a][1]._isInFirstContentOfListItem = !0, a++);
		if (r[0] === "enter") r[1].contentType && (Object.assign(t, dt(u, n)), n = t[n], l = !0);
		else if (r[1]._container) {
			for (a = n, i = void 0; a--;) if (o = u.get(a), o[1].type === "lineEnding" || o[1].type === "lineEndingBlank") o[0] === "enter" && (i && (u.get(i)[1].type = "lineEndingBlank"), o[1].type = "lineEnding", i = a);
			else if (o[1].type !== "linePrefix" && o[1].type !== "listItemIndent") break;
			i && (r[1].end = { ...u.get(i)[1].start }, s = u.slice(i, n), s.unshift(r), u.splice(i, n - i + 1, s));
		}
	}
	return I(e, 0, Infinity, u.slice(0)), !l;
}
function dt(e, t) {
	let n = e.get(t)[1], r = e.get(t)[2], i = t - 1, a = [], o = n._tokenizer;
	o || (o = r.parser[n.contentType](n.start), n._contentTypeTextTrailing && (o._contentTypeTextTrailing = !0));
	let s = o.events, c = [], l = {}, u, d, f = -1, p = n, m = 0, h = 0, g = [h];
	for (; p;) {
		for (; e.get(++i)[1] !== p;);
		a.push(i), p._tokenizer || (u = r.sliceStream(p), p.next || u.push(null), d && o.defineSkip(p.start), p._isInFirstContentOfListItem && (o._gfmTasklistFirstContentOfListItem = !0), o.write(u), p._isInFirstContentOfListItem && (o._gfmTasklistFirstContentOfListItem = void 0)), d = p, p = p.next;
	}
	for (p = n; ++f < s.length;) s[f][0] === "exit" && s[f - 1][0] === "enter" && s[f][1].type === s[f - 1][1].type && s[f][1].start.line !== s[f][1].end.line && (h = f + 1, g.push(h), p._tokenizer = void 0, p.previous = void 0, p = p.next);
	for (o.events = [], p ? (p._tokenizer = void 0, p.previous = void 0) : g.pop(), f = g.length; f--;) {
		let t = s.slice(g[f], g[f + 1]), n = a.pop();
		c.push([n, n + t.length - 1]), e.splice(n, 2, t);
	}
	for (c.reverse(), f = -1; ++f < c.length;) l[m + c[f][0]] = m + c[f][1], m += c[f][1] - c[f][0] - 1;
	return l;
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/content.js
var ft = {
	resolve: mt,
	tokenize: ht
}, pt = {
	partial: !0,
	tokenize: gt
};
function mt(e) {
	return ut(e), e;
}
function ht(e, t) {
	let n;
	return r;
	function r(t) {
		return e.enter("content"), n = e.enter("chunkContent", { contentType: "content" }), i(t);
	}
	function i(t) {
		return t === null ? a(t) : V(t) ? e.check(pt, o, a)(t) : (e.consume(t), i);
	}
	function a(n) {
		return e.exit("chunkContent"), e.exit("content"), t(n);
	}
	function o(t) {
		return e.consume(t), e.exit("chunkContent"), n.next = e.enter("chunkContent", {
			contentType: "content",
			previous: n
		}), n = n.next, i;
	}
}
function gt(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.exit("chunkContent"), e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), K(e, a, "linePrefix");
	}
	function a(i) {
		if (i === null || V(i)) return n(i);
		let a = r.events[r.events.length - 1];
		return !r.parser.constructs.disable.null.includes("codeIndented") && a && a[1].type === "linePrefix" && a[2].sliceSerialize(a[1], !0).length >= 4 ? t(i) : e.interrupt(r.parser.constructs.flow, n, t)(i);
	}
}
//#endregion
//#region node_modules/micromark-factory-destination/index.js
function _t(e, t, n, r, i, a, o, s, c) {
	let l = c || Infinity, u = 0;
	return d;
	function d(t) {
		return t === 60 ? (e.enter(r), e.enter(i), e.enter(a), e.consume(t), e.exit(a), f) : t === null || t === 32 || t === 41 || xe(t) ? n(t) : (e.enter(r), e.enter(o), e.enter(s), e.enter("chunkString", { contentType: "string" }), h(t));
	}
	function f(n) {
		return n === 62 ? (e.enter(a), e.consume(n), e.exit(a), e.exit(i), e.exit(r), t) : (e.enter(s), e.enter("chunkString", { contentType: "string" }), p(n));
	}
	function p(t) {
		return t === 62 ? (e.exit("chunkString"), e.exit(s), f(t)) : t === null || t === 60 || V(t) ? n(t) : (e.consume(t), t === 92 ? m : p);
	}
	function m(t) {
		return t === 60 || t === 62 || t === 92 ? (e.consume(t), p) : p(t);
	}
	function h(i) {
		return !u && (i === null || i === 41 || H(i)) ? (e.exit("chunkString"), e.exit(s), e.exit(o), e.exit(r), t(i)) : u < l && i === 40 ? (e.consume(i), u++, h) : i === 41 ? (e.consume(i), u--, h) : i === null || i === 32 || i === 40 || xe(i) ? n(i) : (e.consume(i), i === 92 ? g : h);
	}
	function g(t) {
		return t === 40 || t === 41 || t === 92 ? (e.consume(t), h) : h(t);
	}
}
//#endregion
//#region node_modules/micromark-factory-label/index.js
function vt(e, t, n, r, i, a) {
	let o = this, s = 0, c;
	return l;
	function l(t) {
		return e.enter(r), e.enter(i), e.consume(t), e.exit(i), e.enter(a), u;
	}
	function u(l) {
		return s > 999 || l === null || l === 91 || l === 93 && !c || 
		/* c8 ignore next 3 */
		l === 94 && !s && "_hiddenFootnoteSupport" in o.parser.constructs ? n(l) : l === 93 ? (e.exit(a), e.enter(i), e.consume(l), e.exit(i), e.exit(r), t) : V(l) ? (e.enter("lineEnding"), e.consume(l), e.exit("lineEnding"), u) : (e.enter("chunkString", { contentType: "string" }), d(l));
	}
	function d(t) {
		return t === null || t === 91 || t === 93 || V(t) || s++ > 999 ? (e.exit("chunkString"), u(t)) : (e.consume(t), c ||= !U(t), t === 92 ? f : d);
	}
	function f(t) {
		return t === 91 || t === 92 || t === 93 ? (e.consume(t), s++, d) : d(t);
	}
}
//#endregion
//#region node_modules/micromark-factory-title/index.js
function yt(e, t, n, r, i, a) {
	let o;
	return s;
	function s(t) {
		return t === 34 || t === 39 || t === 40 ? (e.enter(r), e.enter(i), e.consume(t), e.exit(i), o = t === 40 ? 41 : t, c) : n(t);
	}
	function c(n) {
		return n === o ? (e.enter(i), e.consume(n), e.exit(i), e.exit(r), t) : (e.enter(a), l(n));
	}
	function l(t) {
		return t === o ? (e.exit(a), c(o)) : t === null ? n(t) : V(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), K(e, l, "linePrefix")) : (e.enter("chunkString", { contentType: "string" }), u(t));
	}
	function u(t) {
		return t === o || t === null || V(t) ? (e.exit("chunkString"), l(t)) : (e.consume(t), t === 92 ? d : u);
	}
	function d(t) {
		return t === o || t === 92 ? (e.consume(t), u) : u(t);
	}
}
//#endregion
//#region node_modules/micromark-factory-whitespace/index.js
function bt(e, t) {
	let n;
	return r;
	function r(i) {
		return V(i) ? (e.enter("lineEnding"), e.consume(i), e.exit("lineEnding"), n = !0, r) : U(i) ? K(e, r, n ? "linePrefix" : "lineSuffix")(i) : t(i);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/definition.js
var xt = {
	name: "definition",
	tokenize: Ct
}, St = {
	partial: !0,
	tokenize: wt
};
function Ct(e, t, n) {
	let r = this, i;
	return a;
	function a(t) {
		return e.enter("definition"), o(t);
	}
	function o(t) {
		return vt.call(r, e, s, n, "definitionLabel", "definitionLabelMarker", "definitionLabelString")(t);
	}
	function s(t) {
		return i = R(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1)), t === 58 ? (e.enter("definitionMarker"), e.consume(t), e.exit("definitionMarker"), c) : n(t);
	}
	function c(t) {
		return H(t) ? bt(e, l)(t) : l(t);
	}
	function l(t) {
		return _t(e, u, n, "definitionDestination", "definitionDestinationLiteral", "definitionDestinationLiteralMarker", "definitionDestinationRaw", "definitionDestinationString")(t);
	}
	function u(t) {
		return e.attempt(St, d, d)(t);
	}
	function d(t) {
		return U(t) ? K(e, f, "whitespace")(t) : f(t);
	}
	function f(a) {
		return a === null || V(a) ? (e.exit("definition"), r.parser.defined.push(i), t(a)) : n(a);
	}
}
function wt(e, t, n) {
	return r;
	function r(t) {
		return H(t) ? bt(e, i)(t) : n(t);
	}
	function i(t) {
		return yt(e, a, n, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(t);
	}
	function a(t) {
		return U(t) ? K(e, o, "whitespace")(t) : o(t);
	}
	function o(e) {
		return e === null || V(e) ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/hard-break-escape.js
var Tt = {
	name: "hardBreakEscape",
	tokenize: Et
};
function Et(e, t, n) {
	return r;
	function r(t) {
		return e.enter("hardBreakEscape"), e.consume(t), i;
	}
	function i(r) {
		return V(r) ? (e.exit("hardBreakEscape"), t(r)) : n(r);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/heading-atx.js
var Dt = {
	name: "headingAtx",
	resolve: Ot,
	tokenize: kt
};
function Ot(e, t) {
	let n = e.length - 2, r = 3, i, a;
	return e[r][1].type === "whitespace" && (r += 2), n - 2 > r && e[n][1].type === "whitespace" && (n -= 2), e[n][1].type === "atxHeadingSequence" && (r === n - 1 || n - 4 > r && e[n - 2][1].type === "whitespace") && (n -= r + 1 === n ? 2 : 4), n > r && (i = {
		type: "atxHeadingText",
		start: e[r][1].start,
		end: e[n][1].end
	}, a = {
		type: "chunkText",
		start: e[r][1].start,
		end: e[n][1].end,
		contentType: "text"
	}, I(e, r, n - r + 1, [
		[
			"enter",
			i,
			t
		],
		[
			"enter",
			a,
			t
		],
		[
			"exit",
			a,
			t
		],
		[
			"exit",
			i,
			t
		]
	])), e;
}
function kt(e, t, n) {
	let r = 0;
	return i;
	function i(t) {
		return e.enter("atxHeading"), a(t);
	}
	function a(t) {
		return e.enter("atxHeadingSequence"), o(t);
	}
	function o(t) {
		return t === 35 && r++ < 6 ? (e.consume(t), o) : t === null || H(t) ? (e.exit("atxHeadingSequence"), s(t)) : n(t);
	}
	function s(n) {
		return n === 35 ? (e.enter("atxHeadingSequence"), c(n)) : n === null || V(n) ? (e.exit("atxHeading"), t(n)) : U(n) ? K(e, s, "whitespace")(n) : (e.enter("atxHeadingText"), l(n));
	}
	function c(t) {
		return t === 35 ? (e.consume(t), c) : (e.exit("atxHeadingSequence"), s(t));
	}
	function l(t) {
		return t === null || t === 35 || H(t) ? (e.exit("atxHeadingText"), s(t)) : (e.consume(t), l);
	}
}
//#endregion
//#region node_modules/micromark-util-html-tag-name/index.js
var At = /* @__PURE__ */ "address.article.aside.base.basefont.blockquote.body.caption.center.col.colgroup.dd.details.dialog.dir.div.dl.dt.fieldset.figcaption.figure.footer.form.frame.frameset.h1.h2.h3.h4.h5.h6.head.header.hr.html.iframe.legend.li.link.main.menu.menuitem.nav.noframes.ol.optgroup.option.p.param.search.section.summary.table.tbody.td.tfoot.th.thead.title.tr.track.ul".split("."), jt = [
	"pre",
	"script",
	"style",
	"textarea"
], Mt = {
	concrete: !0,
	name: "htmlFlow",
	resolveTo: Ft,
	tokenize: It
}, Nt = {
	partial: !0,
	tokenize: Rt
}, Pt = {
	partial: !0,
	tokenize: Lt
};
function Ft(e) {
	let t = e.length;
	for (; t-- && (e[t][0] !== "enter" || e[t][1].type !== "htmlFlow"););
	return t > 1 && e[t - 2][1].type === "linePrefix" && (e[t][1].start = e[t - 2][1].start, e[t + 1][1].start = e[t - 2][1].start, e.splice(t - 2, 2)), e;
}
function It(e, t, n) {
	let r = this, i, a, o, s, c;
	return l;
	function l(e) {
		return u(e);
	}
	function u(t) {
		return e.enter("htmlFlow"), e.enter("htmlFlowData"), e.consume(t), d;
	}
	function d(s) {
		return s === 33 ? (e.consume(s), f) : s === 47 ? (e.consume(s), a = !0, h) : s === 63 ? (e.consume(s), i = 3, r.interrupt ? t : P) : z(s) ? (e.consume(s), o = String.fromCharCode(s), g) : n(s);
	}
	function f(a) {
		return a === 45 ? (e.consume(a), i = 2, p) : a === 91 ? (e.consume(a), i = 5, s = 0, m) : z(a) ? (e.consume(a), i = 4, r.interrupt ? t : P) : n(a);
	}
	function p(i) {
		return i === 45 ? (e.consume(i), r.interrupt ? t : P) : n(i);
	}
	function m(i) {
		return i === "CDATA[".charCodeAt(s++) ? (e.consume(i), s === 6 ? r.interrupt ? t : O : m) : n(i);
	}
	function h(t) {
		return z(t) ? (e.consume(t), o = String.fromCharCode(t), g) : n(t);
	}
	function g(s) {
		if (s === null || s === 47 || s === 62 || H(s)) {
			let c = s === 47, l = o.toLowerCase();
			return !c && !a && jt.includes(l) ? (i = 1, r.interrupt ? t(s) : O(s)) : At.includes(o.toLowerCase()) ? (i = 6, c ? (e.consume(s), _) : r.interrupt ? t(s) : O(s)) : (i = 7, r.interrupt && !r.parser.lazy[r.now().line] ? n(s) : a ? v(s) : y(s));
		}
		return s === 45 || B(s) ? (e.consume(s), o += String.fromCharCode(s), g) : n(s);
	}
	function _(i) {
		return i === 62 ? (e.consume(i), r.interrupt ? t : O) : n(i);
	}
	function v(t) {
		return U(t) ? (e.consume(t), v) : E(t);
	}
	function y(t) {
		return t === 47 ? (e.consume(t), E) : t === 58 || t === 95 || z(t) ? (e.consume(t), b) : U(t) ? (e.consume(t), y) : E(t);
	}
	function b(t) {
		return t === 45 || t === 46 || t === 58 || t === 95 || B(t) ? (e.consume(t), b) : x(t);
	}
	function x(t) {
		return t === 61 ? (e.consume(t), S) : U(t) ? (e.consume(t), x) : y(t);
	}
	function S(t) {
		return t === null || t === 60 || t === 61 || t === 62 || t === 96 ? n(t) : t === 34 || t === 39 ? (e.consume(t), c = t, C) : U(t) ? (e.consume(t), S) : w(t);
	}
	function C(t) {
		return t === c ? (e.consume(t), c = null, T) : t === null || V(t) ? n(t) : (e.consume(t), C);
	}
	function w(t) {
		return t === null || t === 34 || t === 39 || t === 47 || t === 60 || t === 61 || t === 62 || t === 96 || H(t) ? x(t) : (e.consume(t), w);
	}
	function T(e) {
		return e === 47 || e === 62 || U(e) ? y(e) : n(e);
	}
	function E(t) {
		return t === 62 ? (e.consume(t), D) : n(t);
	}
	function D(t) {
		return t === null || V(t) ? O(t) : U(t) ? (e.consume(t), D) : n(t);
	}
	function O(t) {
		return t === 45 && i === 2 ? (e.consume(t), j) : t === 60 && i === 1 ? (e.consume(t), M) : t === 62 && i === 4 ? (e.consume(t), F) : t === 63 && i === 3 ? (e.consume(t), P) : t === 93 && i === 5 ? (e.consume(t), te) : V(t) && (i === 6 || i === 7) ? (e.exit("htmlFlowData"), e.check(Nt, ne, k)(t)) : t === null || V(t) ? (e.exit("htmlFlowData"), k(t)) : (e.consume(t), O);
	}
	function k(t) {
		return e.check(Pt, A, ne)(t);
	}
	function A(t) {
		return e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), ee;
	}
	function ee(t) {
		return t === null || V(t) ? k(t) : (e.enter("htmlFlowData"), O(t));
	}
	function j(t) {
		return t === 45 ? (e.consume(t), P) : O(t);
	}
	function M(t) {
		return t === 47 ? (e.consume(t), o = "", N) : O(t);
	}
	function N(t) {
		if (t === 62) {
			let n = o.toLowerCase();
			return jt.includes(n) ? (e.consume(t), F) : O(t);
		}
		return z(t) && o.length < 8 ? (e.consume(t), o += String.fromCharCode(t), N) : O(t);
	}
	function te(t) {
		return t === 93 ? (e.consume(t), P) : O(t);
	}
	function P(t) {
		return t === 62 ? (e.consume(t), F) : t === 45 && i === 2 ? (e.consume(t), P) : O(t);
	}
	function F(t) {
		return t === null || V(t) ? (e.exit("htmlFlowData"), ne(t)) : (e.consume(t), F);
	}
	function ne(n) {
		return e.exit("htmlFlow"), t(n);
	}
}
function Lt(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return V(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), a) : n(t);
	}
	function a(e) {
		return r.parser.lazy[r.now().line] ? n(e) : t(e);
	}
}
function Rt(e, t, n) {
	return r;
	function r(r) {
		return e.enter("lineEnding"), e.consume(r), e.exit("lineEnding"), e.attempt(Be, t, n);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/html-text.js
var zt = {
	name: "htmlText",
	tokenize: Bt
};
function Bt(e, t, n) {
	let r = this, i, a, o;
	return s;
	function s(t) {
		return e.enter("htmlText"), e.enter("htmlTextData"), e.consume(t), c;
	}
	function c(t) {
		return t === 33 ? (e.consume(t), l) : t === 47 ? (e.consume(t), x) : t === 63 ? (e.consume(t), y) : z(t) ? (e.consume(t), w) : n(t);
	}
	function l(t) {
		return t === 45 ? (e.consume(t), u) : t === 91 ? (e.consume(t), a = 0, m) : z(t) ? (e.consume(t), v) : n(t);
	}
	function u(t) {
		return t === 45 ? (e.consume(t), p) : n(t);
	}
	function d(t) {
		return t === null ? n(t) : t === 45 ? (e.consume(t), f) : V(t) ? (o = d, M(t)) : (e.consume(t), d);
	}
	function f(t) {
		return t === 45 ? (e.consume(t), p) : d(t);
	}
	function p(e) {
		return e === 62 ? j(e) : e === 45 ? f(e) : d(e);
	}
	function m(t) {
		return t === "CDATA[".charCodeAt(a++) ? (e.consume(t), a === 6 ? h : m) : n(t);
	}
	function h(t) {
		return t === null ? n(t) : t === 93 ? (e.consume(t), g) : V(t) ? (o = h, M(t)) : (e.consume(t), h);
	}
	function g(t) {
		return t === 93 ? (e.consume(t), _) : h(t);
	}
	function _(t) {
		return t === 62 ? j(t) : t === 93 ? (e.consume(t), _) : h(t);
	}
	function v(t) {
		return t === null || t === 62 ? j(t) : V(t) ? (o = v, M(t)) : (e.consume(t), v);
	}
	function y(t) {
		return t === null ? n(t) : t === 63 ? (e.consume(t), b) : V(t) ? (o = y, M(t)) : (e.consume(t), y);
	}
	function b(e) {
		return e === 62 ? j(e) : y(e);
	}
	function x(t) {
		return z(t) ? (e.consume(t), S) : n(t);
	}
	function S(t) {
		return t === 45 || B(t) ? (e.consume(t), S) : C(t);
	}
	function C(t) {
		return V(t) ? (o = C, M(t)) : U(t) ? (e.consume(t), C) : j(t);
	}
	function w(t) {
		return t === 45 || B(t) ? (e.consume(t), w) : t === 47 || t === 62 || H(t) ? T(t) : n(t);
	}
	function T(t) {
		return t === 47 ? (e.consume(t), j) : t === 58 || t === 95 || z(t) ? (e.consume(t), E) : V(t) ? (o = T, M(t)) : U(t) ? (e.consume(t), T) : j(t);
	}
	function E(t) {
		return t === 45 || t === 46 || t === 58 || t === 95 || B(t) ? (e.consume(t), E) : D(t);
	}
	function D(t) {
		return t === 61 ? (e.consume(t), O) : V(t) ? (o = D, M(t)) : U(t) ? (e.consume(t), D) : T(t);
	}
	function O(t) {
		return t === null || t === 60 || t === 61 || t === 62 || t === 96 ? n(t) : t === 34 || t === 39 ? (e.consume(t), i = t, k) : V(t) ? (o = O, M(t)) : U(t) ? (e.consume(t), O) : (e.consume(t), A);
	}
	function k(t) {
		return t === i ? (e.consume(t), i = void 0, ee) : t === null ? n(t) : V(t) ? (o = k, M(t)) : (e.consume(t), k);
	}
	function A(t) {
		return t === null || t === 34 || t === 39 || t === 60 || t === 61 || t === 96 ? n(t) : t === 47 || t === 62 || H(t) ? T(t) : (e.consume(t), A);
	}
	function ee(e) {
		return e === 47 || e === 62 || H(e) ? T(e) : n(e);
	}
	function j(r) {
		return r === 62 ? (e.consume(r), e.exit("htmlTextData"), e.exit("htmlText"), t) : n(r);
	}
	function M(t) {
		return e.exit("htmlTextData"), e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), N;
	}
	function N(t) {
		return U(t) ? K(e, te, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : te(t);
	}
	function te(t) {
		return e.enter("htmlTextData"), o(t);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/label-end.js
var Vt = {
	name: "labelEnd",
	resolveAll: Gt,
	resolveTo: Kt,
	tokenize: qt
}, Ht = { tokenize: Jt }, Ut = { tokenize: Yt }, Wt = { tokenize: Xt };
function Gt(e) {
	let t = -1, n = [];
	for (; ++t < e.length;) {
		let r = e[t][1];
		if (n.push(e[t]), r.type === "labelImage" || r.type === "labelLink" || r.type === "labelEnd") {
			let e = r.type === "labelImage" ? 4 : 2;
			r.type = "data", t += e;
		}
	}
	return e.length !== n.length && I(e, 0, e.length, n), e;
}
function Kt(e, t) {
	let n = e.length, r = 0, i, a, o, s;
	for (; n--;) if (i = e[n][1], a) {
		if (i.type === "link" || i.type === "labelLink" && i._inactive) break;
		e[n][0] === "enter" && i.type === "labelLink" && (i._inactive = !0);
	} else if (o) {
		if (e[n][0] === "enter" && (i.type === "labelImage" || i.type === "labelLink") && !i._balanced && (a = n, i.type !== "labelLink")) {
			r = 2;
			break;
		}
	} else i.type === "labelEnd" && (o = n);
	let c = {
		type: e[a][1].type === "labelLink" ? "link" : "image",
		start: { ...e[a][1].start },
		end: { ...e[e.length - 1][1].end }
	}, l = {
		type: "label",
		start: { ...e[a][1].start },
		end: { ...e[o][1].end }
	}, u = {
		type: "labelText",
		start: { ...e[a + r + 2][1].end },
		end: { ...e[o - 2][1].start }
	};
	return s = [[
		"enter",
		c,
		t
	], [
		"enter",
		l,
		t
	]], s = L(s, e.slice(a + 1, a + r + 3)), s = L(s, [[
		"enter",
		u,
		t
	]]), s = L(s, Ne(t.parser.constructs.insideSpan.null, e.slice(a + r + 4, o - 3), t)), s = L(s, [
		[
			"exit",
			u,
			t
		],
		e[o - 2],
		e[o - 1],
		[
			"exit",
			l,
			t
		]
	]), s = L(s, e.slice(o + 1)), s = L(s, [[
		"exit",
		c,
		t
	]]), I(e, a, e.length, s), e;
}
function qt(e, t, n) {
	let r = this, i = r.events.length, a, o;
	for (; i--;) if ((r.events[i][1].type === "labelImage" || r.events[i][1].type === "labelLink") && !r.events[i][1]._balanced) {
		a = r.events[i][1];
		break;
	}
	return s;
	function s(t) {
		return a ? a._inactive ? d(t) : (o = r.parser.defined.includes(R(r.sliceSerialize({
			start: a.end,
			end: r.now()
		}))), e.enter("labelEnd"), e.enter("labelMarker"), e.consume(t), e.exit("labelMarker"), e.exit("labelEnd"), c) : n(t);
	}
	function c(t) {
		return t === 40 ? e.attempt(Ht, u, o ? u : d)(t) : t === 91 ? e.attempt(Ut, u, o ? l : d)(t) : o ? u(t) : d(t);
	}
	function l(t) {
		return e.attempt(Wt, u, d)(t);
	}
	function u(e) {
		return t(e);
	}
	function d(e) {
		return a._balanced = !0, n(e);
	}
}
function Jt(e, t, n) {
	return r;
	function r(t) {
		return e.enter("resource"), e.enter("resourceMarker"), e.consume(t), e.exit("resourceMarker"), i;
	}
	function i(t) {
		return H(t) ? bt(e, a)(t) : a(t);
	}
	function a(t) {
		return t === 41 ? u(t) : _t(e, o, s, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(t);
	}
	function o(t) {
		return H(t) ? bt(e, c)(t) : u(t);
	}
	function s(e) {
		return n(e);
	}
	function c(t) {
		return t === 34 || t === 39 || t === 40 ? yt(e, l, n, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(t) : u(t);
	}
	function l(t) {
		return H(t) ? bt(e, u)(t) : u(t);
	}
	function u(r) {
		return r === 41 ? (e.enter("resourceMarker"), e.consume(r), e.exit("resourceMarker"), e.exit("resource"), t) : n(r);
	}
}
function Yt(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return vt.call(r, e, a, o, "reference", "referenceMarker", "referenceString")(t);
	}
	function a(e) {
		return r.parser.defined.includes(R(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1))) ? t(e) : n(e);
	}
	function o(e) {
		return n(e);
	}
}
function Xt(e, t, n) {
	return r;
	function r(t) {
		return e.enter("reference"), e.enter("referenceMarker"), e.consume(t), e.exit("referenceMarker"), i;
	}
	function i(r) {
		return r === 93 ? (e.enter("referenceMarker"), e.consume(r), e.exit("referenceMarker"), e.exit("reference"), t) : n(r);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/label-start-image.js
var Zt = {
	name: "labelStartImage",
	resolveAll: Vt.resolveAll,
	tokenize: Qt
};
function Qt(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.enter("labelImage"), e.enter("labelImageMarker"), e.consume(t), e.exit("labelImageMarker"), a;
	}
	function a(t) {
		return t === 91 ? (e.enter("labelMarker"), e.consume(t), e.exit("labelMarker"), e.exit("labelImage"), o) : n(t);
	}
	function o(e) {
		/* c8 ignore next 3 */
		return e === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/label-start-link.js
var $t = {
	name: "labelStartLink",
	resolveAll: Vt.resolveAll,
	tokenize: en
};
function en(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.enter("labelLink"), e.enter("labelMarker"), e.consume(t), e.exit("labelMarker"), e.exit("labelLink"), a;
	}
	function a(e) {
		/* c8 ignore next 3 */
		return e === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/line-ending.js
var tn = {
	name: "lineEnding",
	tokenize: nn
};
function nn(e, t) {
	return n;
	function n(n) {
		return e.enter("lineEnding"), e.consume(n), e.exit("lineEnding"), K(e, t, "linePrefix");
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/thematic-break.js
var rn = {
	name: "thematicBreak",
	tokenize: an
};
function an(e, t, n) {
	let r = 0, i;
	return a;
	function a(t) {
		return e.enter("thematicBreak"), o(t);
	}
	function o(e) {
		return i = e, s(e);
	}
	function s(a) {
		return a === i ? (e.enter("thematicBreakSequence"), c(a)) : r >= 3 && (a === null || V(a)) ? (e.exit("thematicBreak"), t(a)) : n(a);
	}
	function c(t) {
		return t === i ? (e.consume(t), r++, c) : (e.exit("thematicBreakSequence"), U(t) ? K(e, s, "whitespace")(t) : s(t));
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/list.js
var q = {
	continuation: { tokenize: ln },
	exit: dn,
	name: "list",
	tokenize: cn
}, on = {
	partial: !0,
	tokenize: fn
}, sn = {
	partial: !0,
	tokenize: un
};
function cn(e, t, n) {
	let r = this, i = r.events[r.events.length - 1], a = i && i[1].type === "linePrefix" ? i[2].sliceSerialize(i[1], !0).length : 0, o = 0;
	return s;
	function s(t) {
		let i = r.containerState.type || (t === 42 || t === 43 || t === 45 ? "listUnordered" : "listOrdered");
		if (i === "listUnordered" ? !r.containerState.marker || t === r.containerState.marker : Se(t)) {
			if (r.containerState.type || (r.containerState.type = i, e.enter(i, { _container: !0 })), i === "listUnordered") return e.enter("listItemPrefix"), t === 42 || t === 45 ? e.check(rn, n, l)(t) : l(t);
			if (!r.interrupt || t === 49) return e.enter("listItemPrefix"), e.enter("listItemValue"), c(t);
		}
		return n(t);
	}
	function c(t) {
		return Se(t) && ++o < 10 ? (e.consume(t), c) : (!r.interrupt || o < 2) && (r.containerState.marker ? t === r.containerState.marker : t === 41 || t === 46) ? (e.exit("listItemValue"), l(t)) : n(t);
	}
	function l(t) {
		return e.enter("listItemMarker"), e.consume(t), e.exit("listItemMarker"), r.containerState.marker = r.containerState.marker || t, e.check(Be, r.interrupt ? n : u, e.attempt(on, f, d));
	}
	function u(e) {
		return r.containerState.initialBlankLine = !0, a++, f(e);
	}
	function d(t) {
		return U(t) ? (e.enter("listItemPrefixWhitespace"), e.consume(t), e.exit("listItemPrefixWhitespace"), f) : n(t);
	}
	function f(n) {
		return r.containerState.size = a + r.sliceSerialize(e.exit("listItemPrefix"), !0).length, t(n);
	}
}
function ln(e, t, n) {
	let r = this;
	return r.containerState._closeFlow = void 0, e.check(Be, i, a);
	function i(n) {
		return r.containerState.furtherBlankLines = r.containerState.furtherBlankLines || r.containerState.initialBlankLine, K(e, t, "listItemIndent", r.containerState.size + 1)(n);
	}
	function a(n) {
		return r.containerState.furtherBlankLines || !U(n) ? (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, o(n)) : (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, e.attempt(sn, t, o)(n));
	}
	function o(i) {
		return r.containerState._closeFlow = !0, r.interrupt = void 0, K(e, e.attempt(q, t, n), "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(i);
	}
}
function un(e, t, n) {
	let r = this;
	return K(e, i, "listItemIndent", r.containerState.size + 1);
	function i(e) {
		let i = r.events[r.events.length - 1];
		return i && i[1].type === "listItemIndent" && i[2].sliceSerialize(i[1], !0).length === r.containerState.size ? t(e) : n(e);
	}
}
function dn(e) {
	e.exit(this.containerState.type);
}
function fn(e, t, n) {
	let r = this;
	return K(e, i, "listItemPrefixWhitespace", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
	function i(e) {
		let i = r.events[r.events.length - 1];
		return !U(e) && i && i[1].type === "listItemPrefixWhitespace" ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/setext-underline.js
var pn = {
	name: "setextUnderline",
	resolveTo: mn,
	tokenize: hn
};
function mn(e, t) {
	let n = e.length, r, i, a;
	for (; n--;) if (e[n][0] === "enter") {
		if (e[n][1].type === "content") {
			r = n;
			break;
		}
		e[n][1].type === "paragraph" && (i = n);
	} else e[n][1].type === "content" && e.splice(n, 1), !a && e[n][1].type === "definition" && (a = n);
	let o = {
		type: "setextHeading",
		start: { ...e[r][1].start },
		end: { ...e[e.length - 1][1].end }
	};
	return e[i][1].type = "setextHeadingText", a ? (e.splice(i, 0, [
		"enter",
		o,
		t
	]), e.splice(a + 1, 0, [
		"exit",
		e[r][1],
		t
	]), e[r][1].end = { ...e[a][1].end }) : e[r][1] = o, e.push([
		"exit",
		o,
		t
	]), e;
}
function hn(e, t, n) {
	let r = this, i;
	return a;
	function a(t) {
		let a = r.events.length, s;
		for (; a--;) if (r.events[a][1].type !== "lineEnding" && r.events[a][1].type !== "linePrefix" && r.events[a][1].type !== "content") {
			s = r.events[a][1].type === "paragraph";
			break;
		}
		return !r.parser.lazy[r.now().line] && (r.interrupt || s) ? (e.enter("setextHeadingLine"), i = t, o(t)) : n(t);
	}
	function o(t) {
		return e.enter("setextHeadingLineSequence"), s(t);
	}
	function s(t) {
		return t === i ? (e.consume(t), s) : (e.exit("setextHeadingLineSequence"), U(t) ? K(e, c, "lineSuffix")(t) : c(t));
	}
	function c(r) {
		return r === null || V(r) ? (e.exit("setextHeadingLine"), t(r)) : n(r);
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/flow.js
var gn = { tokenize: _n };
function _n(e) {
	let t = this, n = e.attempt(Be, r, e.attempt(this.parser.constructs.flowInitial, i, K(e, e.attempt(this.parser.constructs.flow, i, e.attempt(ft, i)), "linePrefix")));
	return n;
	function r(r) {
		if (r === null) {
			e.consume(r);
			return;
		}
		return e.enter("lineEndingBlank"), e.consume(r), e.exit("lineEndingBlank"), t.currentConstruct = void 0, n;
	}
	function i(r) {
		if (r === null) {
			e.consume(r);
			return;
		}
		return e.enter("lineEnding"), e.consume(r), e.exit("lineEnding"), t.currentConstruct = void 0, n;
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/text.js
var vn = { resolveAll: Sn() }, yn = xn("string"), bn = xn("text");
function xn(e) {
	return {
		resolveAll: Sn(e === "text" ? Cn : void 0),
		tokenize: t
	};
	function t(t) {
		let n = this, r = this.parser.constructs[e], i = t.attempt(r, a, o);
		return a;
		function a(e) {
			return c(e) ? i(e) : o(e);
		}
		function o(e) {
			if (e === null) {
				t.consume(e);
				return;
			}
			return t.enter("data"), t.consume(e), s;
		}
		function s(e) {
			return c(e) ? (t.exit("data"), i(e)) : (t.consume(e), s);
		}
		function c(e) {
			if (e === null) return !0;
			let t = r[e], i = -1;
			if (t) for (; ++i < t.length;) {
				let e = t[i];
				if (!e.previous || e.previous.call(n, n.previous)) return !0;
			}
			return !1;
		}
	}
}
function Sn(e) {
	return t;
	function t(t, n) {
		let r = -1, i;
		for (; ++r <= t.length;) i === void 0 ? t[r] && t[r][1].type === "data" && (i = r, r++) : (!t[r] || t[r][1].type !== "data") && (r !== i + 2 && (t[i][1].end = t[r - 1][1].end, t.splice(i + 2, r - i - 2), r = i + 2), i = void 0);
		return e ? e(t, n) : t;
	}
}
function Cn(e, t) {
	let n = 0;
	for (; ++n <= e.length;) if ((n === e.length || e[n][1].type === "lineEnding") && e[n - 1][1].type === "data") {
		let r = e[n - 1][1], i = t.sliceStream(r), a = i.length, o = -1, s = 0, c;
		for (; a--;) {
			let e = i[a];
			if (typeof e == "string") {
				for (o = e.length; e.charCodeAt(o - 1) === 32;) s++, o--;
				if (o) break;
				o = -1;
			} else if (e === -2) c = !0, s++;
			else if (e !== -1) {
				a++;
				break;
			}
		}
		if (t._contentTypeTextTrailing && n === e.length && (s = 0), s) {
			let i = {
				type: n === e.length || c || s < 2 ? "lineSuffix" : "hardBreakTrailing",
				start: {
					_bufferIndex: a ? o : r.start._bufferIndex + o,
					_index: r.start._index + a,
					line: r.end.line,
					column: r.end.column - s,
					offset: r.end.offset - s
				},
				end: { ...r.end }
			};
			r.end = { ...i.start }, r.start.offset === r.end.offset ? Object.assign(r, i) : (e.splice(n, 0, [
				"enter",
				i,
				t
			], [
				"exit",
				i,
				t
			]), n += 2);
		}
		n++;
	}
	return e;
}
//#endregion
//#region node_modules/micromark/lib/constructs.js
var wn = /* @__PURE__ */ n({
	attentionMarkers: () => Mn,
	contentInitial: () => En,
	disable: () => Nn,
	document: () => Tn,
	flow: () => On,
	flowInitial: () => Dn,
	insideSpan: () => jn,
	string: () => kn,
	text: () => An
}), Tn = {
	42: q,
	43: q,
	45: q,
	48: q,
	49: q,
	50: q,
	51: q,
	52: q,
	53: q,
	54: q,
	55: q,
	56: q,
	57: q,
	62: He
}, En = { 91: xt }, Dn = {
	[-2]: et,
	[-1]: et,
	32: et
}, On = {
	35: Dt,
	42: rn,
	45: [pn, rn],
	60: Mt,
	61: pn,
	95: rn,
	96: Ze,
	126: Ze
}, kn = {
	38: Je,
	92: Ke
}, An = {
	[-5]: tn,
	[-4]: tn,
	[-3]: tn,
	33: Zt,
	38: Je,
	42: Pe,
	60: [Re, zt],
	91: $t,
	92: [Tt, Ke],
	93: Vt,
	95: Pe,
	96: it
}, jn = { null: [Pe, vn] }, Mn = { null: [42, 95] }, Nn = { null: [] };
//#endregion
//#region node_modules/micromark/lib/create-tokenizer.js
function Pn(e, t, n) {
	let r = {
		_bufferIndex: -1,
		_index: 0,
		line: n && n.line || 1,
		column: n && n.column || 1,
		offset: n && n.offset || 0
	}, i = {}, a = [], o = [], s = [], c = {
		attempt: C(x),
		check: C(S),
		consume: v,
		enter: y,
		exit: b,
		interrupt: C(S, { interrupt: !0 })
	}, l = {
		code: null,
		containerState: {},
		defineSkip: h,
		events: [],
		now: m,
		parser: e,
		previous: null,
		sliceSerialize: f,
		sliceStream: p,
		write: d
	}, u = t.tokenize.call(l, c);
	return t.resolveAll && a.push(t), l;
	function d(e) {
		return o = L(o, e), g(), o[o.length - 1] === null ? (w(t, 0), l.events = Ne(a, l.events, l), l.events) : [];
	}
	function f(e, t) {
		return In(p(e), t);
	}
	function p(e) {
		return Fn(o, e);
	}
	function m() {
		let { _bufferIndex: e, _index: t, line: n, column: i, offset: a } = r;
		return {
			_bufferIndex: e,
			_index: t,
			line: n,
			column: i,
			offset: a
		};
	}
	function h(e) {
		i[e.line] = e.column, E();
	}
	function g() {
		let e;
		for (; r._index < o.length;) {
			let t = o[r._index];
			if (typeof t == "string") for (e = r._index, r._bufferIndex < 0 && (r._bufferIndex = 0); r._index === e && r._bufferIndex < t.length;) _(t.charCodeAt(r._bufferIndex));
			else _(t);
		}
	}
	function _(e) {
		u = u(e);
	}
	function v(e) {
		V(e) ? (r.line++, r.column = 1, r.offset += e === -3 ? 2 : 1, E()) : e !== -1 && (r.column++, r.offset++), r._bufferIndex < 0 ? r._index++ : (r._bufferIndex++, r._bufferIndex === o[r._index].length && (r._bufferIndex = -1, r._index++)), l.previous = e;
	}
	function y(e, t) {
		let n = t || {};
		return n.type = e, n.start = m(), l.events.push([
			"enter",
			n,
			l
		]), s.push(n), n;
	}
	function b(e) {
		let t = s.pop();
		return t.end = m(), l.events.push([
			"exit",
			t,
			l
		]), t;
	}
	function x(e, t) {
		w(e, t.from);
	}
	function S(e, t) {
		t.restore();
	}
	function C(e, t) {
		return n;
		function n(n, r, i) {
			let a, o, s, u;
			return Array.isArray(n) ? f(n) : "tokenize" in n ? f([n]) : d(n);
			function d(e) {
				return t;
				function t(t) {
					let n = t !== null && e[t], r = t !== null && e.null;
					return f([...Array.isArray(n) ? n : n ? [n] : [], ...Array.isArray(r) ? r : r ? [r] : []])(t);
				}
			}
			function f(e) {
				return a = e, o = 0, e.length === 0 ? i : p(e[o]);
			}
			function p(e) {
				return n;
				function n(n) {
					return u = T(), s = e, e.partial || (l.currentConstruct = e), e.name && l.parser.constructs.disable.null.includes(e.name) ? h(n) : e.tokenize.call(t ? Object.assign(Object.create(l), t) : l, c, m, h)(n);
				}
			}
			function m(t) {
				return e(s, u), r;
			}
			function h(e) {
				return u.restore(), ++o < a.length ? p(a[o]) : i;
			}
		}
	}
	function w(e, t) {
		e.resolveAll && !a.includes(e) && a.push(e), e.resolve && I(l.events, t, l.events.length - t, e.resolve(l.events.slice(t), l)), e.resolveTo && (l.events = e.resolveTo(l.events, l));
	}
	function T() {
		let e = m(), t = l.previous, n = l.currentConstruct, i = l.events.length, a = Array.from(s);
		return {
			from: i,
			restore: o
		};
		function o() {
			r = e, l.previous = t, l.currentConstruct = n, l.events.length = i, s = a, E();
		}
	}
	function E() {
		r.line in i && r.column < 2 && (r.column = i[r.line], r.offset += i[r.line] - 1);
	}
}
function Fn(e, t) {
	let n = t.start._index, r = t.start._bufferIndex, i = t.end._index, a = t.end._bufferIndex, o;
	if (n === i) o = [e[n].slice(r, a)];
	else {
		if (o = e.slice(n, i), r > -1) {
			let e = o[0];
			typeof e == "string" ? o[0] = e.slice(r) : o.shift();
		}
		a > 0 && o.push(e[i].slice(0, a));
	}
	return o;
}
function In(e, t) {
	let n = -1, r = [], i;
	for (; ++n < e.length;) {
		let a = e[n], o;
		if (typeof a == "string") o = a;
		else switch (a) {
			case -5:
				o = "\r";
				break;
			case -4:
				o = "\n";
				break;
			case -3:
				o = "\r\n";
				break;
			case -2:
				o = t ? " " : "	";
				break;
			case -1:
				if (!t && i) continue;
				o = " ";
				break;
			default: o = String.fromCharCode(a);
		}
		i = a === -2, r.push(o);
	}
	return r.join("");
}
//#endregion
//#region node_modules/micromark/lib/parse.js
function Ln(e) {
	let t = {
		constructs: ge([wn, ...(e || {}).extensions || []]),
		content: n(Ee),
		defined: [],
		document: n(Oe),
		flow: n(gn),
		lazy: {},
		string: n(yn),
		text: n(bn)
	};
	return t;
	function n(e) {
		return n;
		function n(n) {
			return Pn(t, e, n);
		}
	}
}
//#endregion
//#region node_modules/micromark/lib/postprocess.js
function Rn(e) {
	for (; !ut(e););
	return e;
}
//#endregion
//#region node_modules/micromark/lib/preprocess.js
var zn = /[\0\t\n\r]/g;
function Bn() {
	let e = 1, t = "", n = !0, r;
	return i;
	function i(i, a, o) {
		let s = [], c, l, u, d, f;
		for (i = t + (typeof i == "string" ? i.toString() : new TextDecoder(a || void 0).decode(i)), u = 0, t = "", n &&= (i.charCodeAt(0) === 65279 && u++, void 0); u < i.length;) {
			if (zn.lastIndex = u, c = zn.exec(i), d = c && c.index !== void 0 ? c.index : i.length, f = i.charCodeAt(d), !c) {
				t = i.slice(u);
				break;
			}
			if (f === 10 && u === d && r) s.push(-3), r = void 0;
			else switch (r &&= (s.push(-5), void 0), u < d && (s.push(i.slice(u, d)), e += d - u), f) {
				case 0:
					s.push(65533), e++;
					break;
				case 9:
					for (l = Math.ceil(e / 4) * 4, s.push(-2); e++ < l;) s.push(-1);
					break;
				case 10:
					s.push(-4), e = 1;
					break;
				default: r = !0, e = 1;
			}
			u = d + 1;
		}
		return o && (r && s.push(-5), t && s.push(t), s.push(null)), s;
	}
}
//#endregion
//#region node_modules/micromark-util-decode-string/index.js
var Vn = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function Hn(e) {
	return e.replace(Vn, Un);
}
function Un(e, t, n) {
	if (t) return t;
	if (n.charCodeAt(0) === 35) {
		let e = n.charCodeAt(1), t = e === 120 || e === 88;
		return ye(n.slice(t ? 2 : 1), t ? 16 : 10);
	}
	return me(n) || e;
}
//#endregion
//#region node_modules/unist-util-stringify-position/lib/index.js
function Wn(e) {
	return !e || typeof e != "object" ? "" : "position" in e || "type" in e ? Kn(e.position) : "start" in e || "end" in e ? Kn(e) : "line" in e || "column" in e ? Gn(e) : "";
}
function Gn(e) {
	return qn(e && e.line) + ":" + qn(e && e.column);
}
function Kn(e) {
	return Gn(e && e.start) + "-" + Gn(e && e.end);
}
function qn(e) {
	return e && typeof e == "number" ? e : 1;
}
//#endregion
//#region node_modules/mdast-util-from-markdown/lib/index.js
var Jn = {}.hasOwnProperty;
function Yn(e, t, n) {
	return t && typeof t == "object" && (n = t, t = void 0), Xn(n)(Rn(Ln(n).document().write(Bn()(e, t, !0))));
}
function Xn(e) {
	let t = {
		transforms: [],
		canContainEols: [
			"emphasis",
			"fragment",
			"heading",
			"paragraph",
			"strong"
		],
		enter: {
			autolink: a(z),
			autolinkProtocol: T,
			autolinkEmail: T,
			atxHeading: a(he),
			blockQuote: a(de),
			characterEscape: T,
			characterReference: T,
			codeFenced: a(fe),
			codeFencedFenceInfo: o,
			codeFencedFenceMeta: o,
			codeIndented: a(fe, o),
			codeText: a(pe, o),
			codeTextData: T,
			data: T,
			codeFlowValue: T,
			definition: a(I),
			definitionDestinationString: o,
			definitionLabelString: o,
			definitionTitleString: o,
			emphasis: a(L),
			hardBreakEscape: a(ge),
			hardBreakTrailing: a(ge),
			htmlFlow: a(_e, o),
			htmlFlowData: T,
			htmlText: a(_e, o),
			htmlTextData: T,
			image: a(ve),
			label: o,
			link: a(z),
			listItem: a(be),
			listItemValue: f,
			listOrdered: a(B, d),
			listUnordered: a(B),
			paragraph: a(xe),
			reference: re,
			referenceString: o,
			resourceDestinationString: o,
			resourceTitleString: o,
			setextHeading: a(he),
			strong: a(Se),
			thematicBreak: a(we)
		},
		exit: {
			atxHeading: c(),
			atxHeadingSequence: x,
			autolink: c(),
			autolinkEmail: ue,
			autolinkProtocol: ce,
			blockQuote: c(),
			characterEscapeValue: E,
			characterReferenceMarkerHexadecimal: ae,
			characterReferenceMarkerNumeric: ae,
			characterReferenceValue: oe,
			characterReference: se,
			codeFenced: c(g),
			codeFencedFence: h,
			codeFencedFenceInfo: p,
			codeFencedFenceMeta: m,
			codeFlowValue: E,
			codeIndented: c(_),
			codeText: c(ee),
			codeTextData: E,
			data: E,
			definition: c(),
			definitionDestinationString: b,
			definitionLabelString: v,
			definitionTitleString: y,
			emphasis: c(),
			hardBreakEscape: c(O),
			hardBreakTrailing: c(O),
			htmlFlow: c(k),
			htmlFlowData: E,
			htmlText: c(A),
			htmlTextData: E,
			image: c(M),
			label: te,
			labelText: N,
			lineEnding: D,
			link: c(j),
			listItem: c(),
			listOrdered: c(),
			listUnordered: c(),
			paragraph: c(),
			referenceString: ie,
			resourceDestinationString: P,
			resourceTitleString: F,
			resource: ne,
			setextHeading: c(w),
			setextHeadingLineSequence: C,
			setextHeadingText: S,
			strong: c(),
			thematicBreak: c()
		}
	};
	Zn(t, (e || {}).mdastExtensions || []);
	let n = {};
	return r;
	function r(e) {
		let r = {
			type: "root",
			children: []
		}, a = {
			stack: [r],
			tokenStack: [],
			config: t,
			enter: s,
			exit: l,
			buffer: o,
			resume: u,
			data: n
		}, c = [], d = -1;
		for (; ++d < e.length;) (e[d][1].type === "listOrdered" || e[d][1].type === "listUnordered") && (e[d][0] === "enter" ? c.push(d) : d = i(e, c.pop(), d));
		for (d = -1; ++d < e.length;) {
			let n = t[e[d][0]];
			Jn.call(n, e[d][1].type) && n[e[d][1].type].call(Object.assign({ sliceSerialize: e[d][2].sliceSerialize }, a), e[d][1]);
		}
		if (a.tokenStack.length > 0) {
			let e = a.tokenStack[a.tokenStack.length - 1];
			(e[1] || $n).call(a, void 0, e[0]);
		}
		for (r.position = {
			start: J(e.length > 0 ? e[0][1].start : {
				line: 1,
				column: 1,
				offset: 0
			}),
			end: J(e.length > 0 ? e[e.length - 2][1].end : {
				line: 1,
				column: 1,
				offset: 0
			})
		}, d = -1; ++d < t.transforms.length;) r = t.transforms[d](r) || r;
		return r;
	}
	function i(e, t, n) {
		let r = t - 1, i = -1, a = !1, o, s, c, l;
		for (; ++r <= n;) {
			let t = e[r];
			switch (t[1].type) {
				case "listUnordered":
				case "listOrdered":
				case "blockQuote":
					t[0] === "enter" ? i++ : i--, l = void 0;
					break;
				case "lineEndingBlank":
					t[0] === "enter" && (o && !l && !i && !c && (c = r), l = void 0);
					break;
				case "linePrefix":
				case "listItemValue":
				case "listItemMarker":
				case "listItemPrefix":
				case "listItemPrefixWhitespace": break;
				default: l = void 0;
			}
			if (!i && t[0] === "enter" && t[1].type === "listItemPrefix" || i === -1 && t[0] === "exit" && (t[1].type === "listUnordered" || t[1].type === "listOrdered")) {
				if (o) {
					let i = r;
					for (s = void 0; i--;) {
						let t = e[i];
						if (t[1].type === "lineEnding" || t[1].type === "lineEndingBlank") {
							if (t[0] === "exit") continue;
							s && (e[s][1].type = "lineEndingBlank", a = !0), t[1].type = "lineEnding", s = i;
						} else if (t[1].type !== "linePrefix" && t[1].type !== "blockQuotePrefix" && t[1].type !== "blockQuotePrefixWhitespace" && t[1].type !== "blockQuoteMarker" && t[1].type !== "listItemIndent") break;
					}
					c && (!s || c < s) && (o._spread = !0), o.end = Object.assign({}, s ? e[s][1].start : t[1].end), e.splice(s || r, 0, [
						"exit",
						o,
						t[2]
					]), r++, n++;
				}
				if (t[1].type === "listItemPrefix") {
					let i = {
						type: "listItem",
						_spread: !1,
						start: Object.assign({}, t[1].start),
						end: void 0
					};
					o = i, e.splice(r, 0, [
						"enter",
						i,
						t[2]
					]), r++, n++, c = void 0, l = !0;
				}
			}
		}
		return e[t][1]._spread = a, n;
	}
	function a(e, t) {
		return n;
		function n(n) {
			s.call(this, e(n), n), t && t.call(this, n);
		}
	}
	function o() {
		this.stack.push({
			type: "fragment",
			children: []
		});
	}
	function s(e, t, n) {
		this.stack[this.stack.length - 1].children.push(e), this.stack.push(e), this.tokenStack.push([t, n || void 0]), e.position = {
			start: J(t.start),
			end: void 0
		};
	}
	function c(e) {
		return t;
		function t(t) {
			e && e.call(this, t), l.call(this, t);
		}
	}
	function l(e, t) {
		let n = this.stack.pop(), r = this.tokenStack.pop();
		if (r) r[0].type !== e.type && (t ? t.call(this, e, r[0]) : (r[1] || $n).call(this, e, r[0]));
		else throw Error("Cannot close `" + e.type + "` (" + Wn({
			start: e.start,
			end: e.end
		}) + "): it’s not open");
		n.position.end = J(e.end);
	}
	function u() {
		return le(this.stack.pop());
	}
	function d() {
		this.data.expectingFirstListItemValue = !0;
	}
	function f(e) {
		if (this.data.expectingFirstListItemValue) {
			let t = this.stack[this.stack.length - 2];
			t.start = Number.parseInt(this.sliceSerialize(e), 10), this.data.expectingFirstListItemValue = void 0;
		}
	}
	function p() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.lang = e;
	}
	function m() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.meta = e;
	}
	function h() {
		this.data.flowCodeInside || (this.buffer(), this.data.flowCodeInside = !0);
	}
	function g() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, ""), this.data.flowCodeInside = void 0;
	}
	function _() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e.replace(/(\r?\n|\r)$/g, "");
	}
	function v(e) {
		let t = this.resume(), n = this.stack[this.stack.length - 1];
		n.label = t, n.identifier = R(this.sliceSerialize(e)).toLowerCase();
	}
	function y() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.title = e;
	}
	function b() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.url = e;
	}
	function x(e) {
		let t = this.stack[this.stack.length - 1];
		t.depth ||= this.sliceSerialize(e).length;
	}
	function S() {
		this.data.setextHeadingSlurpLineEnding = !0;
	}
	function C(e) {
		let t = this.stack[this.stack.length - 1];
		t.depth = this.sliceSerialize(e).codePointAt(0) === 61 ? 1 : 2;
	}
	function w() {
		this.data.setextHeadingSlurpLineEnding = void 0;
	}
	function T(e) {
		let t = this.stack[this.stack.length - 1].children, n = t[t.length - 1];
		(!n || n.type !== "text") && (n = Ce(), n.position = {
			start: J(e.start),
			end: void 0
		}, t.push(n)), this.stack.push(n);
	}
	function E(e) {
		let t = this.stack.pop();
		t.value += this.sliceSerialize(e), t.position.end = J(e.end);
	}
	function D(e) {
		let n = this.stack[this.stack.length - 1];
		if (this.data.atHardBreak) {
			let t = n.children[n.children.length - 1];
			t.position.end = J(e.end), this.data.atHardBreak = void 0;
			return;
		}
		!this.data.setextHeadingSlurpLineEnding && t.canContainEols.includes(n.type) && (T.call(this, e), E.call(this, e));
	}
	function O() {
		this.data.atHardBreak = !0;
	}
	function k() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e;
	}
	function A() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e;
	}
	function ee() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e;
	}
	function j() {
		let e = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			let t = this.data.referenceType || "shortcut";
			e.type += "Reference", e.referenceType = t, delete e.url, delete e.title;
		} else delete e.identifier, delete e.label;
		this.data.referenceType = void 0;
	}
	function M() {
		let e = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			let t = this.data.referenceType || "shortcut";
			e.type += "Reference", e.referenceType = t, delete e.url, delete e.title;
		} else delete e.identifier, delete e.label;
		this.data.referenceType = void 0;
	}
	function N(e) {
		let t = this.sliceSerialize(e), n = this.stack[this.stack.length - 2];
		n.label = Hn(t), n.identifier = R(t).toLowerCase();
	}
	function te() {
		let e = this.stack[this.stack.length - 1], t = this.resume(), n = this.stack[this.stack.length - 1];
		this.data.inReference = !0, n.type === "link" ? n.children = e.children : n.alt = t;
	}
	function P() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.url = e;
	}
	function F() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.title = e;
	}
	function ne() {
		this.data.inReference = void 0;
	}
	function re() {
		this.data.referenceType = "collapsed";
	}
	function ie(e) {
		let t = this.resume(), n = this.stack[this.stack.length - 1];
		n.label = t, n.identifier = R(this.sliceSerialize(e)).toLowerCase(), this.data.referenceType = "full";
	}
	function ae(e) {
		this.data.characterReferenceType = e.type;
	}
	function oe(e) {
		let t = this.sliceSerialize(e), n = this.data.characterReferenceType, r;
		n ? (r = ye(t, n === "characterReferenceMarkerNumeric" ? 10 : 16), this.data.characterReferenceType = void 0) : r = me(t);
		let i = this.stack[this.stack.length - 1];
		i.value += r;
	}
	function se(e) {
		let t = this.stack.pop();
		t.position.end = J(e.end);
	}
	function ce(e) {
		E.call(this, e);
		let t = this.stack[this.stack.length - 1];
		t.url = this.sliceSerialize(e);
	}
	function ue(e) {
		E.call(this, e);
		let t = this.stack[this.stack.length - 1];
		t.url = "mailto:" + this.sliceSerialize(e);
	}
	function de() {
		return {
			type: "blockquote",
			children: []
		};
	}
	function fe() {
		return {
			type: "code",
			lang: null,
			meta: null,
			value: ""
		};
	}
	function pe() {
		return {
			type: "inlineCode",
			value: ""
		};
	}
	function I() {
		return {
			type: "definition",
			identifier: "",
			label: null,
			title: null,
			url: ""
		};
	}
	function L() {
		return {
			type: "emphasis",
			children: []
		};
	}
	function he() {
		return {
			type: "heading",
			depth: 0,
			children: []
		};
	}
	function ge() {
		return { type: "break" };
	}
	function _e() {
		return {
			type: "html",
			value: ""
		};
	}
	function ve() {
		return {
			type: "image",
			title: null,
			url: "",
			alt: null
		};
	}
	function z() {
		return {
			type: "link",
			title: null,
			url: "",
			children: []
		};
	}
	function B(e) {
		return {
			type: "list",
			ordered: e.type === "listOrdered",
			start: null,
			spread: e._spread,
			children: []
		};
	}
	function be(e) {
		return {
			type: "listItem",
			spread: e._spread,
			checked: null,
			children: []
		};
	}
	function xe() {
		return {
			type: "paragraph",
			children: []
		};
	}
	function Se() {
		return {
			type: "strong",
			children: []
		};
	}
	function Ce() {
		return {
			type: "text",
			value: ""
		};
	}
	function we() {
		return { type: "thematicBreak" };
	}
}
function J(e) {
	return {
		line: e.line,
		column: e.column,
		offset: e.offset
	};
}
function Zn(e, t) {
	let n = -1;
	for (; ++n < t.length;) {
		let r = t[n];
		Array.isArray(r) ? Zn(e, r) : Qn(e, r);
	}
}
function Qn(e, t) {
	let n;
	for (n in t) if (Jn.call(t, n)) switch (n) {
		case "canContainEols": {
			let r = t[n];
			r && e[n].push(...r);
			break;
		}
		case "transforms": {
			let r = t[n];
			r && e[n].push(...r);
			break;
		}
		case "enter":
		case "exit": {
			let r = t[n];
			r && Object.assign(e[n], r);
			break;
		}
	}
}
function $n(e, t) {
	throw Error(e ? "Cannot close `" + e.type + "` (" + Wn({
		start: e.start,
		end: e.end
	}) + "): a different token (`" + t.type + "`, " + Wn({
		start: t.start,
		end: t.end
	}) + ") is open" : "Cannot close document, a token (`" + t.type + "`, " + Wn({
		start: t.start,
		end: t.end
	}) + ") is still open");
}
//#endregion
//#region node_modules/micromark-extension-gfm-table/lib/edit-map.js
var er = class {
	constructor() {
		this.map = [];
	}
	add(e, t, n) {
		tr(this, e, t, n);
	}
	consume(e) {
		/* c8 ignore next 3 -- `resolve` is never called without tables, so without edits. */
		if (this.map.sort(function(e, t) {
			return e[0] - t[0];
		}), this.map.length === 0) return;
		let t = this.map.length, n = [];
		for (; t > 0;) --t, n.push(e.slice(this.map[t][0] + this.map[t][1]), this.map[t][2]), e.length = this.map[t][0];
		n.push(e.slice()), e.length = 0;
		let r = n.pop();
		for (; r;) {
			for (let t of r) e.push(t);
			r = n.pop();
		}
		this.map.length = 0;
	}
};
function tr(e, t, n, r) {
	let i = 0;
	if (n !== 0 || r.length !== 0) {
		for (; i < e.map.length;) {
			if (e.map[i][0] === t) {
				e.map[i][1] += n, e.map[i][2].push(...r);
				return;
			}
			i += 1;
		}
		e.map.push([
			t,
			n,
			r
		]);
	}
}
//#endregion
//#region node_modules/micromark-extension-gfm-table/lib/infer.js
function nr(e, t) {
	let n = !1, r = [];
	for (; t < e.length;) {
		let i = e[t];
		if (n) {
			if (i[0] === "enter") i[1].type === "tableContent" && r.push(e[t + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
			else if (i[1].type === "tableContent") {
				if (e[t - 1][1].type === "tableDelimiterMarker") {
					let e = r.length - 1;
					r[e] = r[e] === "left" ? "center" : "right";
				}
			} else if (i[1].type === "tableDelimiterRow") break;
		} else i[0] === "enter" && i[1].type === "tableDelimiterRow" && (n = !0);
		t += 1;
	}
	return r;
}
//#endregion
//#region node_modules/micromark-extension-gfm-table/lib/syntax.js
function rr() {
	return { flow: { null: {
		name: "table",
		tokenize: ir,
		resolveAll: ar
	} } };
}
function ir(e, t, n) {
	let r = this, i = 0, a = 0, o;
	return s;
	function s(e) {
		let t = r.events.length - 1;
		for (; t > -1;) {
			let e = r.events[t][1].type;
			if (e === "lineEnding" || e === "linePrefix") t--;
			else break;
		}
		let i = t > -1 ? r.events[t][1].type : null, a = i === "tableHead" || i === "tableRow" ? S : c;
		return a === S && r.parser.lazy[r.now().line] ? n(e) : a(e);
	}
	function c(t) {
		return e.enter("tableHead"), e.enter("tableRow"), l(t);
	}
	function l(e) {
		return e === 124 ? u(e) : (o = !0, a += 1, u(e));
	}
	function u(t) {
		return t === null ? n(t) : V(t) ? a > 1 ? (a = 0, r.interrupt = !0, e.exit("tableRow"), e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), p) : n(t) : U(t) ? K(e, u, "whitespace")(t) : (a += 1, o && (o = !1, i += 1), t === 124 ? (e.enter("tableCellDivider"), e.consume(t), e.exit("tableCellDivider"), o = !0, u) : (e.enter("data"), d(t)));
	}
	function d(t) {
		return t === null || t === 124 || H(t) ? (e.exit("data"), u(t)) : (e.consume(t), t === 92 ? f : d);
	}
	function f(t) {
		return t === 92 || t === 124 ? (e.consume(t), d) : d(t);
	}
	function p(t) {
		return r.interrupt = !1, r.parser.lazy[r.now().line] ? n(t) : (e.enter("tableDelimiterRow"), o = !1, U(t) ? K(e, m, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : m(t));
	}
	function m(t) {
		return t === 45 || t === 58 ? g(t) : t === 124 ? (o = !0, e.enter("tableCellDivider"), e.consume(t), e.exit("tableCellDivider"), h) : x(t);
	}
	function h(t) {
		return U(t) ? K(e, g, "whitespace")(t) : g(t);
	}
	function g(t) {
		return t === 58 ? (a += 1, o = !0, e.enter("tableDelimiterMarker"), e.consume(t), e.exit("tableDelimiterMarker"), _) : t === 45 ? (a += 1, _(t)) : t === null || V(t) ? b(t) : x(t);
	}
	function _(t) {
		return t === 45 ? (e.enter("tableDelimiterFiller"), v(t)) : x(t);
	}
	function v(t) {
		return t === 45 ? (e.consume(t), v) : t === 58 ? (o = !0, e.exit("tableDelimiterFiller"), e.enter("tableDelimiterMarker"), e.consume(t), e.exit("tableDelimiterMarker"), y) : (e.exit("tableDelimiterFiller"), y(t));
	}
	function y(t) {
		return U(t) ? K(e, b, "whitespace")(t) : b(t);
	}
	function b(n) {
		return n === 124 ? m(n) : n === null || V(n) ? !o || i !== a ? x(n) : (e.exit("tableDelimiterRow"), e.exit("tableHead"), t(n)) : x(n);
	}
	function x(e) {
		return n(e);
	}
	function S(t) {
		return e.enter("tableRow"), C(t);
	}
	function C(n) {
		return n === 124 ? (e.enter("tableCellDivider"), e.consume(n), e.exit("tableCellDivider"), C) : n === null || V(n) ? (e.exit("tableRow"), t(n)) : U(n) ? K(e, C, "whitespace")(n) : (e.enter("data"), w(n));
	}
	function w(t) {
		return t === null || t === 124 || H(t) ? (e.exit("data"), C(t)) : (e.consume(t), t === 92 ? T : w);
	}
	function T(t) {
		return t === 92 || t === 124 ? (e.consume(t), w) : w(t);
	}
}
function ar(e, t) {
	let n = -1, r = !0, i = 0, a = [
		0,
		0,
		0,
		0
	], o = [
		0,
		0,
		0,
		0
	], s = !1, c = 0, l, u, d, f = new er();
	for (; ++n < e.length;) {
		let p = e[n], m = p[1];
		p[0] === "enter" ? m.type === "tableHead" ? (s = !1, c !== 0 && (sr(f, t, c, l, u), u = void 0, c = 0), l = {
			type: "table",
			start: Object.assign({}, m.start),
			end: Object.assign({}, m.end)
		}, f.add(n, 0, [[
			"enter",
			l,
			t
		]])) : m.type === "tableRow" || m.type === "tableDelimiterRow" ? (r = !0, d = void 0, a = [
			0,
			0,
			0,
			0
		], o = [
			0,
			n + 1,
			0,
			0
		], s && (s = !1, u = {
			type: "tableBody",
			start: Object.assign({}, m.start),
			end: Object.assign({}, m.end)
		}, f.add(n, 0, [[
			"enter",
			u,
			t
		]])), i = m.type === "tableDelimiterRow" ? 2 : u ? 3 : 1) : i && (m.type === "data" || m.type === "tableDelimiterMarker" || m.type === "tableDelimiterFiller") ? (r = !1, o[2] === 0 && (a[1] !== 0 && (o[0] = o[1], d = or(f, t, a, i, void 0, d), a = [
			0,
			0,
			0,
			0
		]), o[2] = n)) : m.type === "tableCellDivider" && (r ? r = !1 : (a[1] !== 0 && (o[0] = o[1], d = or(f, t, a, i, void 0, d)), a = o, o = [
			a[1],
			n,
			0,
			0
		])) : m.type === "tableHead" ? (s = !0, c = n) : m.type === "tableRow" || m.type === "tableDelimiterRow" ? (c = n, a[1] === 0 ? o[1] !== 0 && (d = or(f, t, o, i, n, d)) : (o[0] = o[1], d = or(f, t, a, i, n, d)), i = 0) : i && (m.type === "data" || m.type === "tableDelimiterMarker" || m.type === "tableDelimiterFiller") && (o[3] = n);
	}
	for (c !== 0 && sr(f, t, c, l, u), f.consume(t.events), n = -1; ++n < t.events.length;) {
		let e = t.events[n];
		e[0] === "enter" && e[1].type === "table" && (e[1]._align = nr(t.events, n));
	}
	return e;
}
function or(e, t, n, r, i, a) {
	let o = r === 1 ? "tableHeader" : r === 2 ? "tableDelimiter" : "tableData";
	n[0] !== 0 && (a.end = Object.assign({}, cr(t.events, n[0])), e.add(n[0], 0, [[
		"exit",
		a,
		t
	]]));
	let s = cr(t.events, n[1]);
	if (a = {
		type: o,
		start: Object.assign({}, s),
		end: Object.assign({}, s)
	}, e.add(n[1], 0, [[
		"enter",
		a,
		t
	]]), n[2] !== 0) {
		let i = cr(t.events, n[2]), a = cr(t.events, n[3]), o = {
			type: "tableContent",
			start: Object.assign({}, i),
			end: Object.assign({}, a)
		};
		if (e.add(n[2], 0, [[
			"enter",
			o,
			t
		]]), r !== 2) {
			let r = t.events[n[2]], i = t.events[n[3]];
			if (r[1].end = Object.assign({}, i[1].end), r[1].type = "chunkText", r[1].contentType = "text", n[3] > n[2] + 1) {
				let t = n[2] + 1, r = n[3] - n[2] - 1;
				e.add(t, r, []);
			}
		}
		e.add(n[3] + 1, 0, [[
			"exit",
			o,
			t
		]]);
	}
	return i !== void 0 && (a.end = Object.assign({}, cr(t.events, i)), e.add(i, 0, [[
		"exit",
		a,
		t
	]]), a = void 0), a;
}
function sr(e, t, n, r, i) {
	let a = [], o = cr(t.events, n);
	i && (i.end = Object.assign({}, o), a.push([
		"exit",
		i,
		t
	])), r.end = Object.assign({}, o), a.push([
		"exit",
		r,
		t
	]), e.add(n + 1, 0, a);
}
function cr(e, t) {
	let n = e[t], r = n[0] === "enter" ? "start" : "end";
	return n[1][r];
}
//#endregion
//#region node_modules/micromark-extension-gfm-strikethrough/lib/syntax.js
function lr(e) {
	let t = (e || {}).singleTilde, n = {
		name: "strikethrough",
		tokenize: i,
		resolveAll: r
	};
	return t ??= !0, {
		text: { 126: n },
		insideSpan: { null: [n] },
		attentionMarkers: { null: [126] }
	};
	function r(e, t) {
		let n = -1;
		for (; ++n < e.length;) if (e[n][0] === "enter" && e[n][1].type === "strikethroughSequenceTemporary" && e[n][1]._close) {
			let r = n;
			for (; r--;) if (e[r][0] === "exit" && e[r][1].type === "strikethroughSequenceTemporary" && e[r][1]._open && e[n][1].end.offset - e[n][1].start.offset === e[r][1].end.offset - e[r][1].start.offset) {
				e[n][1].type = "strikethroughSequence", e[r][1].type = "strikethroughSequence";
				let i = {
					type: "strikethrough",
					start: Object.assign({}, e[r][1].start),
					end: Object.assign({}, e[n][1].end)
				}, a = {
					type: "strikethroughText",
					start: Object.assign({}, e[r][1].end),
					end: Object.assign({}, e[n][1].start)
				}, o = [
					[
						"enter",
						i,
						t
					],
					[
						"enter",
						e[r][1],
						t
					],
					[
						"exit",
						e[r][1],
						t
					],
					[
						"enter",
						a,
						t
					]
				], s = t.parser.constructs.insideSpan.null;
				s && I(o, o.length, 0, Ne(s, e.slice(r + 1, n), t)), I(o, o.length, 0, [
					[
						"exit",
						a,
						t
					],
					[
						"enter",
						e[n][1],
						t
					],
					[
						"exit",
						e[n][1],
						t
					],
					[
						"exit",
						i,
						t
					]
				]), I(e, r - 1, n - r + 3, o), n = r + o.length - 2;
				break;
			}
		}
		for (n = -1; ++n < e.length;) e[n][1].type === "strikethroughSequenceTemporary" && (e[n][1].type = "data");
		return e;
	}
	function i(e, n, r) {
		let i = this.previous, a = this.events, o = 0;
		return s;
		function s(t) {
			return i === 126 && a[a.length - 1][1].type !== "characterEscape" ? r(t) : (e.enter("strikethroughSequenceTemporary"), c(t));
		}
		function c(a) {
			let s = Me(i);
			if (a === 126) return o > 1 ? r(a) : (e.consume(a), o++, c);
			if (o < 2 && !t) return r(a);
			let l = e.exit("strikethroughSequenceTemporary"), u = Me(a);
			return l._open = !u || u === 2 && !!s, l._close = !s || s === 2 && !!u, n(a);
		}
	}
}
//#endregion
//#region node_modules/micromark-extension-gfm-autolink-literal/lib/syntax.js
var ur = {
	tokenize: xr,
	partial: !0
}, dr = {
	tokenize: Sr,
	partial: !0
}, fr = {
	tokenize: Cr,
	partial: !0
}, pr = {
	tokenize: wr,
	partial: !0
}, mr = {
	tokenize: Tr,
	partial: !0
}, hr = {
	name: "wwwAutolink",
	tokenize: yr,
	previous: Er
}, gr = {
	name: "protocolAutolink",
	tokenize: br,
	previous: Dr
}, Y = {
	name: "emailAutolink",
	tokenize: vr,
	previous: Or
}, X = {};
function _r() {
	return { text: X };
}
for (var Z = 48; Z < 123;) X[Z] = Y, Z++, Z === 58 ? Z = 65 : Z === 91 && (Z = 97);
X[43] = Y, X[45] = Y, X[46] = Y, X[95] = Y, X[72] = [Y, gr], X[104] = [Y, gr], X[87] = [Y, hr], X[119] = [Y, hr];
function vr(e, t, n) {
	let r = this, i, a;
	return o;
	function o(t) {
		return !kr(t) || !Or.call(r, r.previous) || Ar(r.events) ? n(t) : (e.enter("literalAutolink"), e.enter("literalAutolinkEmail"), s(t));
	}
	function s(t) {
		return kr(t) ? (e.consume(t), s) : t === 64 ? (e.consume(t), c) : n(t);
	}
	function c(t) {
		return t === 46 ? e.check(mr, u, l)(t) : t === 45 || t === 95 || B(t) ? (a = !0, e.consume(t), c) : u(t);
	}
	function l(t) {
		return e.consume(t), i = !0, c;
	}
	function u(o) {
		return a && i && z(r.previous) ? (e.exit("literalAutolinkEmail"), e.exit("literalAutolink"), t(o)) : n(o);
	}
}
function yr(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return t !== 87 && t !== 119 || !Er.call(r, r.previous) || Ar(r.events) ? n(t) : (e.enter("literalAutolink"), e.enter("literalAutolinkWww"), e.check(ur, e.attempt(dr, e.attempt(fr, a), n), n)(t));
	}
	function a(n) {
		return e.exit("literalAutolinkWww"), e.exit("literalAutolink"), t(n);
	}
}
function br(e, t, n) {
	let r = this, i = "", a = !1;
	return o;
	function o(t) {
		return (t === 72 || t === 104) && Dr.call(r, r.previous) && !Ar(r.events) ? (e.enter("literalAutolink"), e.enter("literalAutolinkHttp"), i += String.fromCodePoint(t), e.consume(t), s) : n(t);
	}
	function s(t) {
		if (z(t) && i.length < 5) return i += String.fromCodePoint(t), e.consume(t), s;
		if (t === 58) {
			let n = i.toLowerCase();
			if (n === "http" || n === "https") return e.consume(t), c;
		}
		return n(t);
	}
	function c(t) {
		return t === 47 ? (e.consume(t), a ? l : (a = !0, c)) : n(t);
	}
	function l(t) {
		return t === null || xe(t) || H(t) || W(t) || Te(t) ? n(t) : e.attempt(dr, e.attempt(fr, u), n)(t);
	}
	function u(n) {
		return e.exit("literalAutolinkHttp"), e.exit("literalAutolink"), t(n);
	}
}
function xr(e, t, n) {
	let r = 0;
	return i;
	function i(t) {
		return (t === 87 || t === 119) && r < 3 ? (r++, e.consume(t), i) : t === 46 && r === 3 ? (e.consume(t), a) : n(t);
	}
	function a(e) {
		return e === null ? n(e) : t(e);
	}
}
function Sr(e, t, n) {
	let r, i, a;
	return o;
	function o(t) {
		return t === 46 || t === 95 ? e.check(pr, c, s)(t) : t === null || H(t) || W(t) || t !== 45 && Te(t) ? c(t) : (a = !0, e.consume(t), o);
	}
	function s(t) {
		return t === 95 ? r = !0 : (i = r, r = void 0), e.consume(t), o;
	}
	function c(e) {
		return i || r || !a ? n(e) : t(e);
	}
}
function Cr(e, t) {
	let n = 0, r = 0;
	return i;
	function i(o) {
		return o === 40 ? (n++, e.consume(o), i) : o === 41 && r < n ? a(o) : o === 33 || o === 34 || o === 38 || o === 39 || o === 41 || o === 42 || o === 44 || o === 46 || o === 58 || o === 59 || o === 60 || o === 63 || o === 93 || o === 95 || o === 126 ? e.check(pr, t, a)(o) : o === null || H(o) || W(o) ? t(o) : (e.consume(o), i);
	}
	function a(t) {
		return t === 41 && r++, e.consume(t), i;
	}
}
function wr(e, t, n) {
	return r;
	function r(o) {
		return o === 33 || o === 34 || o === 39 || o === 41 || o === 42 || o === 44 || o === 46 || o === 58 || o === 59 || o === 63 || o === 95 || o === 126 ? (e.consume(o), r) : o === 38 ? (e.consume(o), a) : o === 93 ? (e.consume(o), i) : o === 60 || o === null || H(o) || W(o) ? t(o) : n(o);
	}
	function i(e) {
		return e === null || e === 40 || e === 91 || H(e) || W(e) ? t(e) : r(e);
	}
	function a(e) {
		return z(e) ? o(e) : n(e);
	}
	function o(t) {
		return t === 59 ? (e.consume(t), r) : z(t) ? (e.consume(t), o) : n(t);
	}
}
function Tr(e, t, n) {
	return r;
	function r(t) {
		return e.consume(t), i;
	}
	function i(e) {
		return B(e) ? n(e) : t(e);
	}
}
function Er(e) {
	return e === null || e === 40 || e === 42 || e === 95 || e === 91 || e === 93 || e === 126 || H(e);
}
function Dr(e) {
	return !z(e);
}
function Or(e) {
	return !(e === 47 || kr(e));
}
function kr(e) {
	return e === 43 || e === 45 || e === 46 || e === 95 || B(e);
}
function Ar(e) {
	let t = e.length, n = !1;
	for (; t--;) {
		let r = e[t][1];
		if ((r.type === "labelLink" || r.type === "labelImage") && !r._balanced) {
			n = !0;
			break;
		}
		if (r._gfmAutolinkLiteralWalkedInto) {
			n = !1;
			break;
		}
	}
	return e.length > 0 && !n && (e[e.length - 1][1]._gfmAutolinkLiteralWalkedInto = !0), n;
}
//#endregion
//#region node_modules/unist-util-is/lib/index.js
var jr = (function(e) {
	if (e == null) return Ir;
	if (typeof e == "function") return Fr(e);
	if (typeof e == "object") return Array.isArray(e) ? Mr(e) : Nr(e);
	if (typeof e == "string") return Pr(e);
	throw Error("Expected function, string, or object as test");
});
function Mr(e) {
	let t = [], n = -1;
	for (; ++n < e.length;) t[n] = jr(e[n]);
	return Fr(r);
	function r(...e) {
		let n = -1;
		for (; ++n < t.length;) if (t[n].apply(this, e)) return !0;
		return !1;
	}
}
function Nr(e) {
	let t = e;
	return Fr(n);
	function n(n) {
		let r = n, i;
		for (i in e) if (r[i] !== t[i]) return !1;
		return !0;
	}
}
function Pr(e) {
	return Fr(t);
	function t(t) {
		return t && t.type === e;
	}
}
function Fr(e) {
	return t;
	function t(t, n, r) {
		return !!(Lr(t) && e.call(this, t, typeof n == "number" ? n : void 0, r || void 0));
	}
}
function Ir() {
	return !0;
}
function Lr(e) {
	return typeof e == "object" && !!e && "type" in e;
}
//#endregion
//#region node_modules/unist-util-visit-parents/lib/color.js
function Rr(e) {
	return e;
}
//#endregion
//#region node_modules/unist-util-visit-parents/lib/index.js
var zr = [];
function Br(e, t, n, r) {
	let i;
	typeof t == "function" && typeof n != "function" ? (r = n, n = t) : i = t;
	let a = jr(i), o = r ? -1 : 1;
	s(e, void 0, [])();
	function s(e, i, c) {
		let l = e && typeof e == "object" ? e : {};
		if (typeof l.type == "string") {
			let t = typeof l.tagName == "string" ? l.tagName : typeof l.name == "string" ? l.name : void 0;
			Object.defineProperty(u, "name", { value: "node (" + Rr(e.type + (t ? "<" + t + ">" : "")) + ")" });
		}
		return u;
		function u() {
			let l = zr, u, d, f;
			if ((!t || a(e, i, c[c.length - 1] || void 0)) && (l = Vr(n(e, c)), l[0] === !1)) return l;
			if ("children" in e && e.children) {
				let t = e;
				if (t.children && l[0] !== "skip") for (d = (r ? t.children.length : -1) + o, f = c.concat(t); d > -1 && d < t.children.length;) {
					let e = t.children[d];
					if (u = s(e, d, f)(), u[0] === !1) return u;
					d = typeof u[1] == "number" ? u[1] : d + o;
				}
			}
			return l;
		}
	}
}
function Vr(e) {
	return Array.isArray(e) ? e : typeof e == "number" ? [!0, e] : e == null ? zr : [e];
}
//#endregion
//#region node_modules/mdast-util-gfm-table/lib/index.js
function Hr() {
	return {
		enter: {
			table: Ur,
			tableData: qr,
			tableHeader: qr,
			tableRow: Gr
		},
		exit: {
			codeText: Jr,
			table: Wr,
			tableData: Kr,
			tableHeader: Kr,
			tableRow: Kr
		}
	};
}
function Ur(e) {
	let t = e._align;
	this.enter({
		type: "table",
		align: t.map(function(e) {
			return e === "none" ? null : e;
		}),
		children: []
	}, e), this.data.inTable = !0;
}
function Wr(e) {
	this.exit(e), this.data.inTable = void 0;
}
function Gr(e) {
	this.enter({
		type: "tableRow",
		children: []
	}, e);
}
function Kr(e) {
	this.exit(e);
}
function qr(e) {
	this.enter({
		type: "tableCell",
		children: []
	}, e);
}
function Jr(e) {
	let t = this.resume();
	this.data.inTable && (t = t.replace(/\\([\\|])/g, Yr));
	let n = this.stack[this.stack.length - 1];
	n.type, n.value = t, this.exit(e);
}
function Yr(e, t) {
	return t === "|" ? t : e;
}
//#endregion
//#region node_modules/mdast-util-gfm-strikethrough/lib/index.js
$r.peek = ei;
function Xr() {
	return {
		canContainEols: ["delete"],
		enter: { strikethrough: Zr },
		exit: { strikethrough: Qr }
	};
}
function Zr(e) {
	this.enter({
		type: "delete",
		children: []
	}, e);
}
function Qr(e) {
	this.exit(e);
}
function $r(e, t, n, r) {
	let i = n.createTracker(r), a = n.enter("strikethrough"), o = i.move("~~");
	return o += n.containerPhrasing(e, {
		...i.current(),
		before: o,
		after: "~"
	}), o += i.move("~~"), a(), o;
}
function ei() {
	return "~";
}
//#endregion
//#region node_modules/ccount/index.js
function ti(e, t) {
	let n = String(e);
	if (typeof t != "string") throw TypeError("Expected character");
	let r = 0, i = n.indexOf(t);
	for (; i !== -1;) r++, i = n.indexOf(t, i + t.length);
	return r;
}
//#endregion
//#region node_modules/mdast-util-find-and-replace/node_modules/escape-string-regexp/index.js
function ni(e) {
	if (typeof e != "string") throw TypeError("Expected a string");
	return e.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
//#endregion
//#region node_modules/mdast-util-find-and-replace/lib/index.js
function ri(e, t, n) {
	let r = jr((n || {}).ignore || []), i = ii(t), a = -1;
	for (; ++a < i.length;) Br(e, "text", o);
	function o(e, t) {
		let n = -1, i;
		for (; ++n < t.length;) {
			let e = t[n], a = i ? i.children : void 0;
			if (r(e, a ? a.indexOf(e) : void 0, i)) return;
			i = e;
		}
		if (i) return s(e, t);
	}
	function s(e, t) {
		let n = t[t.length - 1], r = i[a][0], o = i[a][1], s = 0, c = n.children.indexOf(e), l = !1, u = [];
		r.lastIndex = 0;
		let d = r.exec(e.value);
		for (; d;) {
			let n = d.index, i = {
				index: d.index,
				input: d.input,
				stack: [...t, e]
			}, a = o(...d, i);
			if (typeof a == "string" && (a = a.length > 0 ? {
				type: "text",
				value: a
			} : void 0), a === !1 ? r.lastIndex = n + 1 : (s !== n && u.push({
				type: "text",
				value: e.value.slice(s, n)
			}), Array.isArray(a) ? u.push(...a) : a && u.push(a), s = n + d[0].length, l = !0), !r.global) break;
			d = r.exec(e.value);
		}
		return l ? (s < e.value.length && u.push({
			type: "text",
			value: e.value.slice(s)
		}), n.children.splice(c, 1, ...u)) : u = [e], c + u.length;
	}
}
function ii(e) {
	let t = [];
	if (!Array.isArray(e)) throw TypeError("Expected find and replace tuple or list of tuples");
	let n = !e[0] || Array.isArray(e[0]) ? e : [e], r = -1;
	for (; ++r < n.length;) {
		let e = n[r];
		t.push([ai(e[0]), oi(e[1])]);
	}
	return t;
}
function ai(e) {
	return typeof e == "string" ? new RegExp(ni(e), "g") : e;
}
function oi(e) {
	return typeof e == "function" ? e : function() {
		return e;
	};
}
//#endregion
//#region node_modules/mdast-util-gfm-autolink-literal/lib/index.js
function si() {
	return {
		transforms: [mi],
		enter: {
			literalAutolink: ci,
			literalAutolinkEmail: li,
			literalAutolinkHttp: li,
			literalAutolinkWww: li
		},
		exit: {
			literalAutolink: pi,
			literalAutolinkEmail: fi,
			literalAutolinkHttp: ui,
			literalAutolinkWww: di
		}
	};
}
function ci(e) {
	this.enter({
		type: "link",
		title: null,
		url: "",
		children: []
	}, e);
}
function li(e) {
	this.config.enter.autolinkProtocol.call(this, e);
}
function ui(e) {
	this.config.exit.autolinkProtocol.call(this, e);
}
function di(e) {
	this.config.exit.data.call(this, e);
	let t = this.stack[this.stack.length - 1];
	t.type, t.url = "http://" + this.sliceSerialize(e);
}
function fi(e) {
	this.config.exit.autolinkEmail.call(this, e);
}
function pi(e) {
	this.exit(e);
}
function mi(e) {
	ri(e, [[/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, hi], [/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, gi]], { ignore: ["link", "linkReference"] });
}
function hi(e, t, n, r, i) {
	let a = "";
	if (!yi(i) || (/^w/i.test(t) && (n = t + n, t = "", a = "http://"), !_i(n))) return !1;
	let o = vi(n + r);
	if (!o[0]) return !1;
	let s = {
		type: "link",
		title: null,
		url: a + t + o[0],
		children: [{
			type: "text",
			value: t + o[0]
		}]
	};
	return o[1] ? [s, {
		type: "text",
		value: o[1]
	}] : s;
}
function gi(e, t, n, r) {
	return !yi(r, !0) || /[-\d_]$/.test(n) ? !1 : {
		type: "link",
		title: null,
		url: "mailto:" + t + "@" + n,
		children: [{
			type: "text",
			value: t + "@" + n
		}]
	};
}
function _i(e) {
	let t = e.split(".");
	return !(t.length < 2 || t[t.length - 1] && (/_/.test(t[t.length - 1]) || !/[a-zA-Z\d]/.test(t[t.length - 1])) || t[t.length - 2] && (/_/.test(t[t.length - 2]) || !/[a-zA-Z\d]/.test(t[t.length - 2])));
}
function vi(e) {
	let t = /[!"&'),.:;<>?\]}]+$/.exec(e);
	if (!t) return [e, void 0];
	e = e.slice(0, t.index);
	let n = t[0], r = n.indexOf(")"), i = ti(e, "("), a = ti(e, ")");
	for (; r !== -1 && i > a;) e += n.slice(0, r + 1), n = n.slice(r + 1), r = n.indexOf(")"), a++;
	return [e, n];
}
function yi(e, t) {
	let n = e.input.charCodeAt(e.index - 1);
	return (e.index === 0 || W(n) || Te(n)) && (!t || n !== 47);
}
//#endregion
//#region src/compiler/markdown.ts
var bi = /^(https?:|mailto:|\/|\.\/|\.\.\/|#)/i;
function xi(e) {
	return Yn(e, {
		extensions: [
			rr(),
			lr(),
			_r()
		],
		mdastExtensions: [
			Hr(),
			Xr(),
			si()
		]
	});
}
function Q(e) {
	return e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function Si(e) {
	if (e.type === "text" || e.type === "inlineCode") return e.value;
	let t = e.children;
	return t === void 0 ? "" : t.map(Si).join("");
}
function Ci(e, t) {
	let n = /* @__PURE__ */ new Set(), r = /* @__PURE__ */ new Map();
	if (e.length === 0) return {
		kickers: n,
		levelByDepth: r
	};
	let i = Math.min(...e.map((e) => e.depth));
	for (let t of e) {
		if (t.depth === i) break;
		n.add(t);
	}
	let a = [...new Set(e.filter((e) => !n.has(e)).map((e) => e.depth))].sort((e, t) => e - t);
	for (let [e, n] of a.entries()) r.set(n, Math.min(t + e, 6));
	return {
		kickers: n,
		levelByDepth: r
	};
}
function wi(e) {
	let t = [], n = (e) => {
		e.type === "heading" && t.push(e);
		for (let t of e.children ?? []) n(t);
	};
	return n(e), t;
}
function $(e, t) {
	return (e.children ?? []).map((e) => Ei(e, t)).join("");
}
function Ti(e, t) {
	let n = e.align ?? [], r = (e, r) => `<tr>${e.children.map((e, i) => {
		let a = n[i];
		return `<${r}${a == null ? "" : ` style="text-align: ${a}"`}>${$(e, t)}</${r}>`;
	}).join("")}</tr>\n`, [i, ...a] = e.children;
	return `<table>\n${i === void 0 ? "" : `<thead>\n${r(i, "th")}</thead>\n`}${a.length === 0 ? "" : `<tbody>\n${a.map((e) => r(e, "td")).join("")}</tbody>\n`}</table>\n`;
}
function Ei(e, t) {
	switch (e.type) {
		case "paragraph": return `<p>${$(e, t)}</p>\n`;
		case "heading": {
			let n = e, r = $(n, t);
			if (t.plan.kickers.has(n)) return `<p class="kicker">${r}</p>\n`;
			let i = t.plan.levelByDepth.get(n.depth) ?? 6;
			return t.outline.push({
				level: i,
				text: Si(n)
			}), `<h${i}>${r}</h${i}>\n`;
		}
		case "text": return Q(e.value);
		case "emphasis": return `<em>${$(e, t)}</em>`;
		case "strong": return `<strong>${$(e, t)}</strong>`;
		case "delete": return `<del>${$(e, t)}</del>`;
		case "inlineCode": return `<code>${Q(e.value)}</code>`;
		case "break": return "<br>\n";
		case "thematicBreak": return "<hr>\n";
		case "blockquote": return `<blockquote>\n${$(e, t)}</blockquote>\n`;
		case "table": return Ti(e, t);
		case "list": {
			let n = e, r = n.ordered === !0 ? "ol" : "ul";
			return `<${r}>\n${$(n, t)}</${r}>\n`;
		}
		case "listItem": return `<li>${e.children.map((e) => e.type === "paragraph" ? $(e, t) : Ei(e, t)).join("")}</li>\n`;
		case "code": {
			let t = e;
			return `<pre><code${typeof t.lang == "string" && t.lang !== "" ? ` class="language-${Q(t.lang)}"` : ""}>${Q(t.value)}\n</code></pre>\n`;
		}
		case "link": {
			let n = e, r = $(n, t);
			if (!bi.test(n.url)) return r;
			let i = /^https?:/i.test(n.url) ? " rel=\"noopener\"" : "";
			return `<a href="${Q(n.url)}"${i}>${r}</a>`;
		}
		case "image": {
			let t = e;
			return bi.test(t.url) ? `<img src="${Q(t.url)}" alt="${Q(t.alt ?? "")}">` : "";
		}
		case "html": return "";
		default: return "";
	}
}
function Di(e, t = 2) {
	let n = xi(e), r = {
		plan: Ci(wi(n), t),
		outline: []
	};
	return {
		html: $(n, r),
		outline: r.outline
	};
}
//#endregion
//#region src/compiler/assemblePage.ts
function Oi(e, t) {
	let n = { ...t };
	for (let [t, r] of Object.entries(e)) {
		let e = n[t];
		e !== void 0 && (r.type === "markdown" && typeof e == "string" && (n[t] = Di(e, 1).html), r.type === "list" && Array.isArray(e) && (n[t] = e.map((e) => Oi(r.fields ?? {}, e))), r.type === "group" && typeof e == "object" && e && !Array.isArray(e) && (n[t] = Oi(r.fields ?? {}, e)));
	}
	return n;
}
//#endregion
//#region studio/engine/engine.ts
function ki(e, t) {
	let n = te(t);
	return { render(t) {
		let r = Oi(e, se(e, t));
		return ie(n, r, e);
	} };
}
//#endregion
export { ki as createBlockRenderer, _ as morphPlugin };
