"""Compile reviewed Chinese pages and source snapshots into the reader's data file."""
from pathlib import Path
import json,re,html
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
src=ROOT/'content/source';zh=ROOT/'content/zh'
index=json.loads((src/'index.json').read_text())
urlmap={p['sourceUrl']:('/guide/'+p['slug']) for p in index}
urlmap.update({
 'https://developer.android.com/design/ui/ai-glasses/guides/interaction/earcons':'/guide/sound-earcons',
 'https://developer.android.com/design/ui/ai-glasses/guides/interaction/audio-input':'/guide/sound-audio-input',
 'https://developer.android.com/design/ui/ai-glasses/guides/sound/create-bespoke-earcons':'/guide/sound-bespoke-earcon',
 'https://developer.android.com/design/ui/ai-glasses/sound/earcon':'/guide/sound-earcons',
})

def clean_body(body,en=False):
 s=BeautifulSoup(body,'html.parser')
 for el in s.select('script,style,button,android-parallax-hero,devsite-hats-survey,devsite-recommendations,devsite-thumb-rating'):
  el.decompose()
 for a in list(s.find_all('a',href=True)):
  if a.get_text(' ',strip=True).startswith(('Previous','Next')):
   a.decompose();continue
  href=a['href'].split('?')[0];base,sep,frag=href.partition('#')
  if base in urlmap:
   a['href']=urlmap[base]+(('#'+frag) if sep else '')
   a.attrs.pop('target',None);a.attrs.pop('rel',None)
  elif href.startswith(('https://','http://')):
   a['target']='_blank';a['rel']='noopener noreferrer'
 for media in s.find_all(['video','audio']):
  media['controls']='';media['preload']='none'
  media.attrs.pop('autoplay',None)
 for im in s.find_all('img'):im['loading']='lazy'
 headings=[];seen=set()
 for i,h in enumerate(s.find_all(['h2','h3','h4'])):
  title=h.get_text(' ',strip=True)
  id=h.get('id') or ('section-'+str(i+1))
  if id in seen:id+='-'+str(i)
  seen.add(id)
  h['id']=('en-' if en else '')+id
  if title not in ['Do',"Don't",'建议','避免','推荐','不建议','应当','不应当'] and not title.startswith(('Do:','Don’t')):
   headings.append({'id':id,'title':title,'level':int(h.name[1])})
 for el in s.find_all(True):
  for attr in list(el.attrs):
   if attr.startswith('on'):del el.attrs[attr]
 return str(s),headings,s.get_text(' ',strip=True)

pages=[];missing=[]
for item in index:
 path=zh/(item['slug']+'.json')
 if not path.exists():missing.append(item['slug']);continue
 d=json.loads(path.read_text());orig=json.loads((src/(item['slug']+'.json')).read_text())
 body,headings,text=clean_body(d['body'])
 en,_,_=clean_body(orig['bodyEn'],True)
 pages.append({**d,'body':body,'bodyEn':en,'headings':headings,'text':text,'readMinutes':max(1,round(len(text)/450)),'imageCount':len(BeautifulSoup(body,'html.parser').find_all('img'))})
(ROOT/'content/library.json').write_text(json.dumps(pages,ensure_ascii=False,separators=(',',':')))
print(json.dumps({'compiled':len(pages),'missing':missing,'textCharacters':sum(len(p['text']) for p in pages)},ensure_ascii=False))
