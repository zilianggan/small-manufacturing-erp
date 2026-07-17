import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, isValidPhone } from './validators';

test('isValidEmail accepts a well-formed address', () => {
  assert.equal(isValidEmail('someone@example.com'), true);
});

test('isValidEmail rejects a string with no @', () => {
  assert.equal(isValidEmail('not-an-email'), false);
});

test('isValidEmail rejects a string with no domain', () => {
  assert.equal(isValidEmail('someone@'), false);
});

test('isValidPhone accepts a Malaysian mobile number without a country code', () => {
  assert.equal(isValidPhone('012-345 6789'), true);
});

test('isValidPhone accepts a number with an explicit non-MY country code', () => {
  assert.equal(isValidPhone('+1 202-555-0143'), true);
});

test('isValidPhone rejects an obviously invalid string', () => {
  assert.equal(isValidPhone('abcdef'), false);
});
