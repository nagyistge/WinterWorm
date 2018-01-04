// @flow

// System for handling changes to the game state
// e.g. adding/removing entities, changing scenes
import { view } from 'ramda';

import { queueLens, getEvents } from '../events';
import { setState } from '../core';
import { makeId } from '../util';
import { META } from '../symbols';
import type { System, GameState } from '../types';

// Processes all events on the meta queue (gameState.state.events.queue)
// and returns an updated game state. This is used for adding, removing
// entities or any other game state modifications
const meta: System = {
  id: makeId(),
  fn: (state: GameState): GameState => {
    const eventsQueue = view(queueLens, state);
    const events = getEvents(eventsQueue, [META]);

    if (!events || !events.length === 0) return state;
    return events.reduce((next, event) => (
      setState(next, event.action)
    ), state);
  },
};

export default meta;