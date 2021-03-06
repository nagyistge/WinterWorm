// @flow
import {
  __,
  view,
  assocPath,
  append,
  lensPath,
  lensProp,
  over,
  dissocPath,
  compose,
  assoc,
} from 'ramda';

import {
  FN,
  SYSTEMS,
  SCENES,
  ENTITIES,
  COMPONENTS,
  CURRENT_SCENE,
  STATE,
  UPDATE_FNS,
  CLEANUP_FN,
} from './symbols';
import { conjoin, concatKeywords } from './util';
import { getSubscribedEvents, emitEventsToQueue, getEventQueue } from './events';

import type { GameState, Scene, Id } from './types';

export const getScene = (state: GameState, sceneId: Id): GameState => (
  view(lensPath([SCENES, sceneId]), state)
);

//  Add or update existing scene in the game state. A scene is a
//  collection of systems. systems are a collection of keywords referencing
//  a system by their unique ID.
export const setScene = (state: GameState, scene: Scene): GameState => (
  assocPath([SCENES, scene.id], scene, state)
);

export const getCurrentScene = (state: GameState): GameState => (
  view(lensProp(CURRENT_SCENE), state)
);

// Sets current scene of the game
export const setCurrentScene = (state: GameState, id: Id): GameState => (
  assoc(CURRENT_SCENE, id, state)
);

export const getUpdateFn = (state: GameState) => {
  const currentSceneId = getCurrentScene(state);
  const updateFnLens = lensPath([UPDATE_FNS, currentSceneId]);
  return view(updateFnLens, state);
};

// Return array of system functions with a uId incl. in the systemIds
export const getSystemFns = (state: GameState, systemIds: Array<Id>) => (
  systemIds.map(id => view(lensPath([SYSTEMS, id, FN]), state))
);

// Returns a list of all entity IDs that have the specified componentId.
const getEntityIdsWithComponent = (state: GameState, componentId: Id): Array<Id> => (
  view(lensPath([COMPONENTS, componentId, ENTITIES]), state)
);

export const getSubscribedComponentIds = (
  state: GameState,
  eventName
): Array<Id> => {
  const components = state[COMPONENTS];
  return Object.keys(components).reduce((total, cId) => {
    const { subscriptions } = components[cId];
    if (subscriptions && subscriptions.includes(eventName)) total.push(cId);
    return total;
  }, []);
};

export const getSubscribedEntityIds = (state: GameState, eventName) => (
  getSubscribedComponentIds(state, eventName).reduce((total, cId) => (
    total.concat(getEntityIdsWithComponent(state, cId))
  ), [])
);

// Returns a set of all entity IDs that have all the specified component-ids.
// Iterate through all the entities and only accumulate the ones
// that have all the required component IDs.
export const getMultiComponentEntityIds = (
  state: GameState,
  componentIds: Array<Id>
): Set<Id> => {
  const components = new Set(componentIds);
  const entities = view(lensPath([ENTITIES]), state);
  const entityIds = Object.keys(entities);

  const result = new Set();
  for (const entityId of entityIds) {
    const entityComponentIds = entities[entityId];
    if (entityComponentIds.every(components.has)) result.add(entityId);
  }

  return result;
};

export const getComponent = (
  state: GameState,
  componentId: Id
): GameState => view(lensPath([COMPONENTS, componentId]), state);

export const setComponent = (
  state: GameState,
  component: Component
): GameState => {
  const { id, fn } = component;

  if (!fn) throw new Error(`Component ${id} missing fn!`);
  return over(lensPath([COMPONENTS, id]), conjoin(component), state);
};

// Returns an object of state associated with the component for the given
// entityId. If not found, it returns an empty object.
export const getComponentState = (
  state: GameState,
  componentId: Id,
  entityId: Id
) => view(lensPath([STATE, componentId, entityId]), state);

export const setComponentState = (state, componentId, entityId, initialCS = {}) => (
  assocPath([STATE, componentId, entityId], initialCS, state)
);

const getComponentContext = (state, eventQueue, entityId, component) => {
  const { subscriptions, context } = component;
  const messages = getSubscribedEvents(eventQueue, entityId, subscriptions);
  const newContext = { inbox: messages };

  if (!context) return newContext;
  // for each item (componentId or object of { entityId, componentId })
  // this component listens to, get that component state and add it to the
  // component's next context object.
  for (const item of context) {
    let ctxtEntityId = entityId;
    let ctxtComponentId = item;
    let assocTarget = item;

    if (item && typeof item === 'object') {
      ctxtEntityId = item.entityId;
      ctxtComponentId = item.componentId;
      assocTarget = concatKeywords(ctxtComponentId, ctxtEntityId);
    }

    const componentState = getComponentState(state, ctxtComponentId, ctxtEntityId);
    newContext[assocTarget] = componentState;
  }

  return newContext;
};

// Gets all state associated with a component
const getAllComponentState = (state, componentId) => (
  view(lensPath([STATE, componentId]), state)
);

const getNextSystemStateAndEvents = (state, componentId) => {
  const entityIds = getEntityIdsWithComponent(state, componentId);
  if (!entityIds) return { nextState: state, events: [] };

  const componentStates = getAllComponentState(state, componentId);
  const component = getComponent(state, componentId);
  const eventsQueue = getEventQueue(state);
  const newComponentState = {};
  const newEvents = [];

  // loop through each entity concerned with this sytestem, get the entity's
  // component state, then get the next component's state, which might be
  // just its state, or an array, containing its state, and a second value
  // which may be an array of events, or a single event.
  for (const entityId of entityIds) {
    const componentState = componentStates[entityId];
    const context = getComponentContext(state, eventsQueue, entityId, component);
    let nextComponentState = component.fn(entityId, componentState, context);
    let events;

    if (Array.isArray(nextComponentState)) {
      [nextComponentState, events] = nextComponentState;
      if (events) {
        if (Array.isArray(events)) for (const event of events) newEvents.push(event);
        else newEvents.push(events);
      }
    }

    newComponentState[entityId] = nextComponentState;
  }

  return {
    events: newEvents,
    nextState: assocPath([STATE, componentId], newComponentState, state),
  };
};

// Returns a function representing a system that takes a single argument for
// game state.
const setSystemFn = (componentId: Id) => (state: GameState): GameState => {
  const { nextState, events } = getNextSystemStateAndEvents(state, componentId);
  return emitEventsToQueue(nextState, events);
};

// adds the system function to state
export const setSystem = (state: GameState, system) => {
  const { id, fn, component, label } = system;

  if (component) {
    const componentId = component.id;
    const systemFn = setSystemFn(componentId);
    const next = assocPath([SYSTEMS, id], { ...system, fn: systemFn }, state);
    return setComponent(next, { id: componentId, ...component });
  }

  if (!fn) throw new Error(`Invalid spec for system: ${label}! Missing 'fn'`);
  return assocPath([SYSTEMS, id], system, state);
};

// Returns a function that returns an updated state with component state
// generated for the given entityId. If no initial component state is given,
// it will default to an empty object.
const componentStateFromSpec = (entityId: Id) => (
  state: GameState,
  component
): GameState => {
  const { id, state: componentState } = component;
  return compose(
    over(lensPath([ENTITIES, entityId]), append(id), __),
    over(lensPath([COMPONENTS, id, ENTITIES]), append(entityId), __),
    setComponentState(__, id, entityId, componentState)
  )(state);
};

export const setEntity = (state: GameState, entity) => {
  const { id, components } = entity;
  const componentStateFn = componentStateFromSpec(id);

  return components.reduce((nextState, component) => (
    componentStateFn(nextState, component)
  ), state);
};

const removeEntityFromComponentIndex = (
  state: GameState,
  entityId: Id,
  componentIds: Array<Id>
) => componentIds.reduce((nextState: GameState, componentId: Id) => (
  dissocPath([COMPONENTS, componentId, ENTITIES, componentId], nextState)
), state);

export const removeEntity = (state: GameState, entityId): GameState => {
  const entity = view(lensPath([ENTITIES, entityId]), state);
  const tasks = [];

  // get all of entities' components and gather up its cleanup tasks
  for (const component of entity) {
    // if the component has a clean up task run it with the entityId
    const componentId = component.id;
    const cleanupFn = view(lensPath([COMPONENTS, componentId, CLEANUP_FN]), state);
    if (cleanupFn) tasks.push(cleanupFn(__, entityId));
  }

  // remove the entity from state
  tasks.push(dissocPath([STATE, ENTITIES, entityId], __));

  // remove the entity itself
  tasks.push(dissocPath([ENTITIES, entityId], __));

  // remove it from the component index
  tasks.push(removeEntityFromComponentIndex(__, entityId));

  // compose over the accumulated deletion tasks and call with state
  return compose(...tasks)(state);
};
