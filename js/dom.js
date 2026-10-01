export const dom = {
    get(id) {
        const el = document.getElementById(id);
        if (!el) console.warn(`[DOM Warning] Element #${id} not found.`);
        return el;
    },
    setText(id, text) {
        const el = this.get(id);
        // 用 textContent 而不是 innerText：前者是标准 API、不触发强制重排，
        // 而且 innerText 会受 CSS 可见性影响（隐藏元素上读写语义不一致）
        if (el) el.textContent = text;
    },
    setHTML(id, html) {
        const el = this.get(id);
        if (el) el.innerHTML = html;
    },
    show(id) {
        const el = this.get(id);
        if (el) el.classList.remove('hidden');
    },
    hide(id) {
        const el = this.get(id);
        if (el) el.classList.add('hidden');
    },
    getValue(id, fallback = null) {
        const el = this.get(id);
        return el ? el.value : fallback;
    },
    setValue(id, val) {
        const el = this.get(id);
        if (el) el.value = val;
    }
};
