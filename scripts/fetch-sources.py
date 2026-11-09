"""Fetch the openly licensed Android AI Glasses documentation for translation.
Run with beautifulsoup4 installed. Original URLs and update dates remain attached.
"""
from pathlib import Path
import concurrent.futures, hashlib, json, re, urllib.request, urllib.parse
from bs4 import BeautifulSoup, Comment

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'content' / 'source'
OUT.mkdir(parents=True, exist_ok=True)
ASSETS = ROOT / 'public' / 'assets' / 'original'
ASSETS.mkdir(parents=True, exist_ok=True)
BASE = 'https://developer.android.com/design/ui/ai-glasses'
GROUPS = {
 'foundations':['design-principles','made-for-glasses','get-started'],
 'surfaces':['overview','sysui','app','ai-in-your-app'],
 'interaction':['inputs','permissions','navigation','ai-patterns','onboarding'],
 'sound':['overview','earcons','voice-alerts','audio-input','bespoke-earcon'],
 'styles':['overview','color','type','surfaces','icons'],
 'components':['overview','buttons','button-group','title-chip','cards','icon-marker','lists','pager','progress','stack','voice-indicator']
}
PAGES=[('overview','overview',BASE)]+[(g+'-'+s,g,BASE+'/guides/'+g+'/'+s) for g,ss in GROUPS.items() for s in ss]

def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept-Language':'en'})
 with urllib.request.urlopen(req,timeout=45) as r: return r.read()

def page(job):
 slug, group, url = job
 raw = fetch(url+'?hl=en')
 soup=BeautifulSoup(raw,'html.parser')
 title=soup.select_one('h1')
 title=title.get_text(' ',strip=True) if title else soup.title.get_text(' ',strip=True).split('|')[0].strip()
 title=title.split('Stay organized with collections')[0].strip()
 body=soup.select_one('.devsite-article-body') or soup.select_one('article')
 if body is None: raise ValueError('No article found: '+url)
 # Several official pages close this wrapper before the article actually ends.
 # Retain following article siblings up to the post-article survey.
 nodes=[body]+list(body.next_siblings)
 full=soup.new_tag('div')
 for node in nodes:
  if getattr(node,'name',None) in ['devsite-hats-survey','devsite-content-footer','devsite-recommendations']: break
  full.append(node)
 body=full
 updated=re.search(r'Last updated (\d{4}-\d{2}-\d{2})',soup.get_text(' ',strip=True))
 for el in body.select('script,style,button,devsite-feedback,devsite-collections,devsite-toc,devsite-hats-survey,devsite-recommendations,devsite-thumb-rating,nav,.devsite-page-nav,.devsite-content-footer,.devsite-banner,.material-icons-round,.material-icons,.devsite-floating-action-buttons'):
  el.decompose()
 for c in body.find_all(string=lambda text:isinstance(text,Comment)): c.extract()
 for a in body.find_all('a',href=True):
  a['href']=urllib.parse.urljoin(url,a['href'])
  if a['href'].startswith('https://'): a['target']='_blank';a['rel']='noopener noreferrer'
 assets=[]
 for el in body.find_all(['img','source','video','audio']):
  for attr in ['src','poster']:
   if not el.get(attr): continue
   asseturl=urllib.parse.urljoin(url,el[attr])
   el[attr]=asseturl
   if urllib.parse.urlparse(asseturl).hostname=='developer.android.com':
    name=Path(urllib.parse.urlparse(asseturl).path).name
    name=hashlib.sha1(asseturl.encode()).hexdigest()[:8]+'-'+name
    assets.append({'url':asseturl,'local':'/assets/original/'+name})
    el[attr]='/assets/original/'+name
  if el.name=='img':
   el['loading']='lazy'
   if not el.get('alt') or el['alt'].startswith('An XR differentiated'): el['alt']='Android Developers 原始示意图'
  if el.name in ['video','audio']: el['controls']='';el['preload']='none'
 for el in body.find_all(True):
  attrs={k:v for k,v in el.attrs.items() if k in ['href','src','poster','alt','id','colspan','rowspan','controls','preload','loading','target','rel','type']}
  if el.name=='aside':attrs['class']='source-note'
  el.attrs=attrs
  if el.name.startswith('devsite-'):el.unwrap()
 for el in body.find_all(['div','span']):
  if not el.attrs:el.unwrap()
 html=body.decode_contents().strip()
 text=body.get_text('\n',strip=True)
 doc={'slug':slug,'group':group,'englishTitle':title,'sourceUrl':url,'sourceUpdated':updated.group(1) if updated else None,'fetchedAt':'2026-11-09','bodyEn':html,'textEn':text,'assets':assets}
 (OUT/(slug+'.json')).write_text(json.dumps(doc,ensure_ascii=False,indent=2))
 (OUT/(slug+'.txt')).write_text(text)
 print(f'{slug}: {len(text)} chars; {len(assets)} assets',flush=True)
 return doc

def asset(item):
 path=ROOT/'public'/item['local'].lstrip('/')
 if not path.exists():path.write_bytes(fetch(item['url']))
 return len(path.read_bytes())

if __name__=='__main__':
 docs=[];errors=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
  fs={ex.submit(page,j):j for j in PAGES}
  for f in concurrent.futures.as_completed(fs):
   try:docs.append(f.result())
   except Exception as e:errors.append({'page':fs[f][0],'error':str(e)})
 order={j[0]:i for i,j in enumerate(PAGES)}
 docs.sort(key=lambda x:order[x['slug']])
 (OUT/'index.json').write_text(json.dumps([{k:d[k] for k in ['slug','group','englishTitle','sourceUrl','sourceUpdated','fetchedAt']} for d in docs],ensure_ascii=False,indent=2))
 assets={a['url']:a for d in docs for a in d['assets']}
 failures=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
  fs={ex.submit(asset,a):a for a in assets.values()}
  for f in concurrent.futures.as_completed(fs):
   try:f.result()
   except Exception as e:failures.append({**fs[f],'error':str(e)})
 (OUT/'fetch-report.json').write_text(json.dumps({'pages':len(docs),'errors':errors,'assets':len(assets),'assetErrors':failures},ensure_ascii=False,indent=2))
 print(json.dumps({'pages':len(docs),'errors':errors,'assets':len(assets),'assetErrors':failures},ensure_ascii=False),flush=True)
