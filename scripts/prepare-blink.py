"""Extract locally generated natural eyelids into a registered transparent overlay."""
from PIL import Image
from pathlib import Path
import numpy as np,json,hashlib
root=Path(__file__).resolve().parents[1]
source=root/'art/masters/m05-blink-generated.png'
generated=Image.open(source).convert('RGBA');neutral=Image.open(root/'art/masters/m05-cat.png').convert('RGBA')
assert generated.size==neutral.size==(941,1672)
w,h=neutral.size;yy,xx=np.indices((h,w),dtype=float)
# Larger masks keep all original sclera/eyelashes inside full opacity, feather only surrounding unchanged fur.
eye_regions=[{'center':[150,575],'radii':[190,115]},{'center':[565,675],'radii':[165,105]}]
mask=np.zeros((h,w))
for r in eye_regions:
 cx,cy=r['center'];rx,ry=r['radii'];distance=np.sqrt(((xx-cx)/rx)**2+((yy-cy)/ry)**2)
 t=np.clip((1-distance)/.15,0,1);fall=t*t*(3-2*t)
 mask=np.maximum(mask,fall)
a=np.asarray(generated.getchannel('A'),dtype=float)/255
mask=np.round(mask*a*255).astype('uint8')
layer=generated.copy();layer.putalpha(Image.fromarray(mask));layer.save(root/'art/masters/m05-blink.png')
layer.save(root/'public/assets/m05-blink.webp','WEBP',quality=94,method=6)
# Show the actual selected master + overlay, not a wholesale frame replacement.
combined=Image.alpha_composite(neutral,layer)
cream=Image.new('RGBA',neutral.size,(255,245,228,255));cream.alpha_composite(combined)
cream.convert('RGB').resize((470,836)).save(root/'art/m05-blink-overlay-review.jpg',quality=94)
# Side by side eye-region comparison.
crops=[]
for pic in [neutral,combined]:
 bg=Image.new('RGBA',neutral.size,(255,245,228,255));bg.alpha_composite(pic)
 crops.append(bg.convert('RGB').crop((0,430,780,810)))
review=Image.new('RGB',(1560,380),(255,245,228));review.paste(crops[0],(0,0));review.paste(crops[1],(780,0));review.save(root/'art/m05-blink-eye-review.jpg',quality=95)
meta={'sourceReferenceId':'R05','selectedNeutralMaster':'art/masters/m05-cat.png','generatedMaster':'art/masters/m05-blink-generated.png','generatedSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'overlayMaster':'art/masters/m05-blink.png','delivery':'public/assets/m05-blink.webp','dimensions':[w,h],'eyeRegions':eye_regions,'method':'Single natural closed-eyelid state, full-frame registered overlay with local elliptical feathering. Only eyelids and immediate fur appear; original nose/head/body remain rendered underneath. No geometric eye squash. No translation or warp needed: generated nose/framing match selected master.','featherFraction':.15,'deliveryBytes':(root/'public/assets/m05-blink.webp').stat().st_size}
(root/'art/m05-blink-manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'dimensions':[w,h],'deliveryBytes':meta['deliveryBytes'],'alphaAtNose':int(mask[666,348]),'alphaBounds':layer.getchannel('A').getbbox()}))
