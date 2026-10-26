"""Build aligned open-box layers from the image-generated master; no drawing of box surfaces."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import numpy as np
import json,hashlib
root=Path(__file__).resolve().parents[1]
source=root/'art/masters/m02-box-open-generated.png'
im=Image.open(source).convert('RGBA');w,h=im.size
# Native measured cardboard silhouette. The polygon excludes the generated atmospheric halo.
outer=[(107,216),(981,151),(1454,234),(1458,773),(666,916),(107,740)]
ss=4
mask=Image.new('L',(w*ss,h*ss),0)
ImageDraw.Draw(mask).polygon([(x*ss,y*ss) for x,y in outer],fill=255)
mask=mask.resize(im.size,Image.Resampling.LANCZOS)
a=np.asarray(im.getchannel('A')).copy();a[a<=2]=0
a=np.minimum(a,np.asarray(mask));im.putalpha(Image.fromarray(a))
im.save(root/'art/masters/m02-box-open.png')
im.save(root/'public/assets/m02-box-open.webp','WEBP',quality=94,method=6)
# Front rim passes through A→D→C. A small 2px layer overlap prevents a subpixel seam.
A=(107,216);D=(666,315);C=(1454,234)
yy,xx=np.indices((h,w))
edge=np.where(xx<=D[0], A[1]+(xx-A[0])*(D[1]-A[1])/(D[0]-A[0]), D[1]+(xx-D[0])*(C[1]-D[1])/(C[0]-D[0]))
for name,selector in [('back',yy<=edge+2),('front',yy>=edge-2)]:
 layer=im.copy();layer.putalpha(Image.fromarray(np.where(selector,a,0).astype('uint8')))
 layer.save(root/f'art/masters/m02-box-{name}.png')
 layer.save(root/f'public/assets/m02-box-{name}.webp','WEBP',quality=94,method=6)
# Cream composite and layer contact sheet for visual edge inspection.
cream=Image.new('RGBA',im.size,(255,245,228,255));cream.alpha_composite(im)
cream.convert('RGB').resize((768,512)).save(root/'art/m02-box-open-review.jpg',quality=94)
back=Image.open(root/'art/masters/m02-box-back.png');front=Image.open(root/'art/masters/m02-box-front.png')
contact=Image.new('RGB',(1152,256),(255,245,228))
for idx,pic in enumerate([im,back,front]):
 tile=Image.new('RGBA',im.size,(255,245,228,255));tile.alpha_composite(pic);contact.paste(tile.convert('RGB').resize((384,256)),(idx*384,0))
contact.save(root/'art/m02-box-layer-review.jpg',quality=94)
meta={'sourceReferenceId':'R02','master':'art/masters/m02-box-open.png','rawGeneratedMaster':'art/masters/m02-box-open-generated.png','rawSourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'dimensions':[w,h],'transparent':True,'outerSilhouettePx':outer,'outerSilhouetteNormalized':[[x/w,y/h]for x,y in outer],'openingPolygonPx':[[130,217],[980,164],[1423,243],[665,306]],'openingPolygonNormalized':[[130/w,217/h],[980/w,164/h],[1423/w,243/h],[665/w,306/h]],'openingAnchorPx':[800,235],'openingAnchorNormalized':[800/w,235/h],'frontRimPx':[list(A),list(D),list(C)],'frontRimNormalized':[[x/w,y/h]for x,y in[A,D,C]],'layerOverlapPx':2,'layers':{'back':'public/assets/m02-box-back.webp','front':'public/assets/m02-box-front.webp','combined':'public/assets/m02-box-open.webp'},'suggestedStageTransform':{'x':250,'y':839,'width':620,'height':350},'suggestedOpeningAnchorStage':[250+800/w*620,839+235/h*350],'processing':'Antialiased outer cardboard silhouette removes generated atmosphere. alpha<=2 cleared. Back/interior above front rim; front wall/rim below rim. No old asset overwritten.','deliveryBytes':{name:(root/f'public/assets/m02-box-{name}.webp').stat().st_size for name in ['open','back','front']}}
(root/'public/assets/m02-box-layers.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'dimensions':[w,h],'deliveryBytes':meta['deliveryBytes'],'openingAnchorStage':meta['suggestedOpeningAnchorStage']}))
