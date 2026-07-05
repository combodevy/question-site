export const dom = {
    get(id) {
        const el = document.getElementById(id);
        if (!el) console.warn(`[DOM Warning] Element #${id} not found.`);
        return el;
    },
    setText(id, text) {
        const el = this.get(id);
        if (el) el.innerText = text;
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
