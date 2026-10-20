/* Narration script (the single source of truth): each page is a list of subtitle lines (cues), and the page's animation
 * is timed to cue numbers. A cue is a string, or { t, hold }: hold keeps a few more seconds after the line for the animation.
 * Each page.id maps to pages/<id>.js; a page with no drawing yet shows as a big title. */
(function (root) {
  const META = {
    title: '__TITLE__',     // title of the narration script
    name: '__TITLE__',      // file name prefix of the rendered film
    libs: [],               // third-party libraries (paths under engine_modules, .css or UMD .js), e.g. 'katex/dist/katex.min.js'
    gap: 0.5,               // pause between pages (s); the engine's default is 1.5
    extras: [],             // this project's own component files (relative to this folder), loaded before the pages
    publish: {              // publishing notes (npm run publish → out/发布信息.md); chapters = the PAGES sections below, timecodes computed
      titles: {
        bilibili: '',       // ≤ 80 characters
        youtube: '',        // ≤ 100 characters
        douyin: '',         // ≤ 30 characters
        shipinhao: '',      // WeChat Channels short title, ≤ 16 characters
        xiaohongshu: '',    // ≤ 20 characters
      },
      description: ``,      // 3–6 sentences: what this film covers and what viewers take away; the chapter list is appended automatically
      tags: [],
    },
  };
  const PAGES = [
    // ───────────────────────── Opening
    { id: 'p01', section: '__SECTION__', title: '__TITLE__', cues: [   // placeholder lines in the film's language (tools/project.mjs)
      '__HELLO__',
      '__TOPIC__',
      { t: '__ASK__', hold: 0.6 },
    ] },
  ];
  root.SCRIPT = { META, PAGES };
})(typeof window !== 'undefined' ? window : globalThis);
