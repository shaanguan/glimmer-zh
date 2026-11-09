/** Add layout wrappers to the existing flat Chinese overview without reserializing it. */
export function formatOverview(body: string): string {
  const sections = Array.from(body.matchAll(/<h2(?=\s|>)/gi), match => match.index!);
  if (sections.length === 0) return body;

  const intro = body.slice(0, sections[0]);
  const figureEnd = /<\/figure\s*>/i.exec(intro);
  if (!/^\s*<figure(?=\s|>)/i.test(intro) || !figureEnd) return body;

  const copyStart = figureEnd.index + figureEnd[0].length;
  // The source introduction supplies the page title; keep its text and ID intact.
  const copy = intro.slice(copyStart).replace(
    /<h3(\s[^>]*)?>([\s\S]*?)<\/h3(\s*)>/i,
    "<h1$1>$2</h1$3>",
  );
  let result = `<section class="overview-intro">${intro.slice(0, copyStart)}<div class="overview-intro-copy">${copy}</div></section>`;

  for (let index = 0; index < sections.length; index += 1) {
    const section = body.slice(sections[index], sections[index + 1] ?? body.length);
    const figures = Array.from(section.matchAll(/<figure(?=\s|>)/gi), match => match.index!);
    let content = section;

    if (figures.length > 0) {
      const cards = figures.map((start, cardIndex) => {
        const card = section.slice(start, figures[cardIndex + 1] ?? section.length);
        return `<div class="overview-card">${card}</div>`;
      }).join("");
      content = `${section.slice(0, figures[0])}<div class="overview-cards" data-count="${figures.length}">${cards}</div>`;
    }

    result += `<section class="overview-section">${content}</section>`;
  }

  return result;
}
