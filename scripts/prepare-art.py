"""Clean only negligible alpha contamination; preserve source PNG masters."""
from pathlib import Path
import json, hashlib, time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT/'public/assets'
ART = ROOT/'art'
ART.mkdir(exist_ok=True)
records=[]
clean={}
master_paths=sorted((ROOT/'art/masters').glob('*.png')) or sorted(ASSETS.glob('*.png'))
for p in master_paths:
    if p.stem.startswith('m05-cat-v') or p.stem.endswith('-generated'):
        continue  # Retain material iterations in art/, publish only the selected neutral master.
    if p.stem in {'m02-box-open', 'm02-box-back', 'm02-box-front', 'm05-blink', 'm05-hand-clean'}:
        continue  # Derived alpha/layer assets have their own reproducible scripts and metadata.
    im=Image.open(p)
    if im.mode != 'RGBA':
        continue
    before=np.asarray(im.getchannel('A')).copy()
    after=before.copy()
    after[after <= 2] = 0
    method='Clear alpha <=2/255 (invisible canvas contamination); retain alpha 3..255 exactly'
    if p.stem=='m02-box':
        # Physical hard cardboard silhouette, from native-resolution visual inspection.
        vertices=[(106,215),(1040,139),(1429,226),(1429,803),(651,913),(106,753)]
        ss=4
        mask=Image.new('L',(im.width*ss,im.height*ss),0)
        ImageDraw.Draw(mask).polygon([(x*ss,y*ss) for x,y in vertices],fill=255)
        mask=mask.resize(im.size,Image.Resampling.LANCZOS)
        after=np.minimum(after,np.asarray(mask))
        method += '; antialiased physical six-corner box silhouette mask removes generated outside glow'
    im.putalpha(Image.fromarray(after))
    out=ASSETS/(p.stem+'.webp')
    temporary=out.with_name(out.name+'.tmp')
    im.save(temporary,'WEBP',quality=94,method=6)
    temporary.replace(out)
    clean[p.stem]=im
    records.append({'source':str(p.relative_to(ROOT)),'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'output':str(out.relative_to(ROOT)),'method':method,'dimensions':list(im.size),'changedAlphaPixels':int(np.count_nonzero(before!=after)),'outputBytes':out.stat().st_size,'masterPreserved':True})

# No UI or reference screenshot baked into menu thumbnails. Compose isolated actors.
def background(size,top,bottom):
    a=np.zeros((size[1],size[0],3),dtype=np.uint8)
    for y in range(size[1]):
        t=y/max(1,size[1]-1)
        a[y,:]=[round(top[c]*(1-t)+bottom[c]*t) for c in range(3)]
    return Image.fromarray(a).convert('RGBA')
def opaque_crop(im):
    a=im.getchannel('A').point(lambda x:255 if x>8 else 0)
    return im.crop(a.getbbox())
def place(canvas,im,xy,size):
    layer=im.resize(size,Image.Resampling.LANCZOS)
    canvas.alpha_composite(layer,xy)

palettes=[((255,247,231),(219,232,204)),((255,248,230),(248,220,179)),((255,243,221),(237,211,180)),((255,247,223),(249,225,180)),((255,242,226),(244,219,193)),((255,248,226),(232,223,198))]
for mode in range(1,7):
    canvas=background((800,600),*palettes[mode-1])
    if mode==1:
        im=opaque_crop(clean['m01-cat']); crop=im.crop((0,0,im.width,round(im.height*.70)))
        w=650;h=round(crop.height*w/crop.width); place(canvas,crop,((800-w)//2,14),(w,h))
    elif mode==2:
        im=opaque_crop(clean['m02-cat']); h=545;w=round(im.width*h/im.height);place(canvas,im,((800-w)//2,25),(w,h))
    elif mode==3:
        im=opaque_crop(clean['m03-cat']);h=580;w=round(im.width*h/im.height);place(canvas,im,((800-w)//2,30),(w,h))
    elif mode==4:
        im=opaque_crop(clean['m04-cat']); w=610;h=round(im.height*w/im.width);place(canvas,im,((800-w)//2,125),(w,h))
        cap=opaque_crop(clean['m04-banana']);w=545;h=round(cap.height*w/cap.width);place(canvas,cap,(164,-55),(w,h))
    elif mode==5:
        im=opaque_crop(clean['m05-cat']);w=750;h=round(im.height*w/im.width);place(canvas,im,((800-w)//2,-6),(w,h))
    else:
        im=opaque_crop(clean['m06-cat']);h=570;w=round(im.width*h/im.height);place(canvas,im,(98,28),(w,h))
        wand=opaque_crop(clean['m06-wand']);h=260;w=round(wand.width*h/wand.height);place(canvas,wand,(555,-44),(w,h))
    output=ASSETS/f'thumb-{mode:02}.webp'
    canvas=canvas.convert('RGB').resize((400,300),Image.Resampling.LANCZOS)
    temporary=output.with_name(output.name+'.tmp')
    canvas.save(temporary,'WEBP',quality=83,method=6)
    temporary.replace(output)
    records.append({'output':str(output.relative_to(ROOT)),'method':'400x300 independent composition of isolated game actors; no reference UI or text','dimensions':[400,300],'outputBytes':output.stat().st_size})
(ART/'processing.json').write_text(json.dumps({'version':1,'notes':['PNG masters unchanged','No new characters drawn or generated during processing','Fine fur alpha >=3 retained','Cardboard only uses hard silhouette mask'],'assets':records},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'processedSprites':len(clean),'thumbnails':6,'thumbnailBytes':[ (ASSETS/f'thumb-{i:02}.webp').stat().st_size for i in range(1,7)]}))
