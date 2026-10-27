import test from 'node:test';
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
test('sealed box round trip like GitHub expects', async () => {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  const sealed = sodium.crypto_box_seal(sodium.from_string('s3cret'), kp.publicKey);
  const b64 = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
  const opened = sodium.crypto_box_seal_open(sodium.from_base64(b64, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey);
  assert.equal(sodium.to_string(opened), 's3cret');
});
