"""Validate chapter coverage, source media, specification numbers, and internal links."""
from pathlib import Path
import json,re,sys
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
index=json.loads((ROOT/'content/source/index.json').read_text())
pages=json.loads((ROOT/'content/library.json').read_text())
errors=[];notes=[];total_media=0
if len(pages)!=34:errors.append(f'Expected 34 translated pages, got {len(pages)}')
slugs={p['slug'] for p in pages}
for p in pages:
 source=json.loads((ROOT/'content/source'/(p['slug']+'.json')).read_text())
 en=BeautifulSoup(source['bodyEn'],'html.parser')
 zh=BeautifulSoup(p['body'],'html.parser')
 em={e.get(a) for e in en.find_all(['img','video','audio','source']) for a in ['src','poster'] if e.get(a)}
 zm={e.get(a) for e in zh.find_all(['img','video','audio','source']) for a in ['src','poster'] if e.get(a)}
 if em-zm:errors.append({'page':p['slug'],'missingMedia':sorted(em-zm)})
 for m in zm:
  if m.startswith('/') and not (ROOT/'public'/m.lstrip('/')).exists():errors.append({'page':p['slug'],'missingFile':m})
 total_media+=len(zm)
 for a in zh.find_all('a',href=True):
  if a['href'].startswith('/guide/'):
   dest=a['href'].split('#')[0].split('/guide/')[1]
   if dest not in slugs:errors.append({'page':p['slug'],'brokenLink':a['href']})
 ids=[h.get('id') for h in zh.find_all(['h2','h3','h4'])]
 if len(ids)!=len(set(ids)):errors.append({'page':p['slug'],'duplicateHeadingIds':ids})
 entext=en.get_text(' ',strip=True);zhtext=zh.get_text(' ',strip=True)
 # Only numeric values of 10 or higher: simple 1/2/3 frequently become Chinese words.
 # A shared trailing unit (15–60 ms) is equivalent to repeating it (15ms–60ms).
 numeric=lambda text:set(x for x in re.findall(r'(?<![A-Za-z0-9])\d+(?:\.\d+)?',text) if float(x)>=10)
 missing=numeric(entext)-numeric(zhtext)
 if missing:notes.append({'page':p['slug'],'numericReview':sorted(missing)})
report={'pages':len(pages),'translatedCharacters':sum(len(p['text']) for p in pages),'mediaReferences':total_media,'errors':errors,'reviewNotes':notes}
(ROOT/'content/validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
