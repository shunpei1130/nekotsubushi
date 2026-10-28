/** Constructed simulator-only integration preconditions. Not gameplay evidence. */
import {writeFile} from 'node:fs/promises';
import {unlockedRegressionSave} from '../tests/journey-fixtures.ts';
await writeFile('ios/App/AppUITests/qualifying-history.json',JSON.stringify(unlockedRegressionSave()));
