/* store.js : what the editor keeps in this browser. Drafts, saved versions and the sprite library live in localStorage until the
   online store of phase 4 exists; every read and write is guarded (private windows and blocked storage must not break the page). */
(function (root) {
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const del = (k) => { try { localStorage.removeItem(k); } catch (e) { /* nothing to do */ } };
  root.NutStore = {
    // the draft is what Preview shows (the game reads the same key when the address has ?layout=draft)
    draft: (slug) => get('nutshell.draft.' + slug, null),
    saveDraft: (slug, doc) => set('nutshell.draft.' + slug, doc),
    clearDraft: (slug) => del('nutshell.draft.' + slug),
    versions: (slug) => get('nutshell.versions.' + slug, []),
    addVersion(slug, label, doc) { const v = get('nutshell.versions.' + slug, []); v.unshift({ t: Date.now(), label, doc }); return set('nutshell.versions.' + slug, v.slice(0, 20)); },
    library: () => get('nutshell.library', { sprites: {} }),
    saveLibrary: (lib) => set('nutshell.library', lib),
    note: (k, d) => get('nutshell.editor.' + k, d), setNote: (k, v) => set('nutshell.editor.' + k, v)
  };
})(window);
