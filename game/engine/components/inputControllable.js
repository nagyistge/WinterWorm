// @flow
import { makeId } from '../util';
import { COMPONENTS, KEYBOARD_INPUT } from '../symbols';
import { hasEventInInbox, makeEvent } from '../events';

import type { Component } from '../types';

const INPUT_CONTROLLABLE = 'inputControllable';

// this component takes keyboard input and turns it into events for the
// same entity based on a mapping passed in initially
const inputControllable: Component = {
  label: INPUT_CONTROLLABLE,
  id: makeId(COMPONENTS),
  subscriptions: [KEYBOARD_INPUT],
  fn: (entityId, componentState, context) => {
    const { inbox } = context;
    const input = hasEventInInbox(KEYBOARD_INPUT)(inbox);

    if (!input) return componentState;

    const { inputEventMap } = componentState;
    const inputEvents = Object.keys(input).reduce((events, key) => {
      if (!inputEventMap[key]) return events;
      const { selector, action } = inputEventMap[key];
      return events.concat([makeEvent(action, [selector, entityId])]);
    }, []);

    return [componentState, inputEvents];
  },
};

export { inputControllable };
