"""CI-only signing setup. Reads explicitly configured secrets; never logs values."""
import base64, datetime, os, pathlib, plistlib, re, subprocess

temporary=pathlib.Path(os.environ['RUNNER_TEMP'])
for key in ['IOS_DISTRIBUTION_P12_BASE64','IOS_DISTRIBUTION_P12_PASSWORD','IOS_PROVISION_PROFILE_BASE64']:
    if not os.environ.get(key): raise SystemExit('Missing protected GitHub Secret: '+key)
certificate=temporary/'neko-signing.p12'
profile=temporary/'neko-profile.mobileprovision'
certificate.write_bytes(base64.b64decode(os.environ['IOS_DISTRIBUTION_P12_BASE64'],validate=True));certificate.chmod(0o600)
profile.write_bytes(base64.b64decode(os.environ['IOS_PROVISION_PROFILE_BASE64'],validate=True));profile.chmod(0o600)
data=plistlib.loads(subprocess.check_output(['security','cms','-D','-i',str(profile)],stderr=subprocess.DEVNULL))
team=data['TeamIdentifier'][0];uuid=data['UUID'];bundle='jp.shunpei1130.nekotsubushi'
assert re.fullmatch(r'[A-Z0-9]{10}',team) and re.fullmatch(r'[A-Fa-f0-9-]{36}',uuid),'Invalid signing profile identifiers'
assert data['Entitlements']['application-identifier']==team+'.'+bundle,'Signing profile is for a different app'
assert not data['Entitlements'].get('get-task-allow') and not data.get('ProvisionedDevices') and not data.get('ProvisionsAllDevices'),'An App Store distribution profile is required'
assert data['ExpirationDate']>datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),'Signing profile expired'
profiles=pathlib.Path.home()/'Library/MobileDevice/Provisioning Profiles';profiles.mkdir(parents=True,exist_ok=True)
(profiles/(uuid+'.mobileprovision')).write_bytes(profile.read_bytes())
with open(os.environ['GITHUB_ENV'],'a') as f:f.write('NEKO_TEAM_ID='+team+'\nNEKO_PROFILE_UUID='+uuid+'\n')
(temporary/'neko-export.plist').write_bytes(plistlib.dumps({'method':'app-store-connect','teamID':team,'signingStyle':'manual','provisioningProfiles':{bundle:uuid},'uploadSymbols':True}))
print('Validated the owner-provided App Store signing profile; private material was not logged.')
