// The Yahoo chart normaliser lives with the app, which uses it for its interim provider while
// this Worker is not deployed, so both sides normalise the same way from one file.
export * from '../../../src/services/market/normalise';
