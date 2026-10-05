import type { WorldState, GameCommand, RulesCatalog, DeterministicEnvironment, SpatialFacts, QueuedEventReaction, ReactionActionOption, UncommittedRuleEvent } from './domain';
import { foldEvents } from './reducer';
import { hasReactionTrigger, triggerOwner } from './triggerOwnership';
type EventInput = Omit<UncommittedRuleEvent, 'ordinal'>;
export interface EventReactionServices {
    options(world: WorldState, opportunity: QueuedEventReaction, catalog: RulesCatalog): ReactionActionOption[];
    executeAutomatic(world: WorldState, opportunity: QueuedEventReaction, option: ReactionActionOption): EventInput[] | null;
}
/** Queue order, observer facts and choice persistence; availability/payment/execution stay in the canonical handler. */
export function queueEventReactions(world: WorldState, execution: EventInput[], command: GameCommand, catalog: RulesCatalog, env: DeterministicEnvironment, originalWorld: WorldState, services: EventReactionServices): EventInput[] {
    const queue = [...(world.eventReactions ?? [])];
    let currentWorld = world;
    const append = (inputs: EventInput[]) => {
        for (const recorded of inputs) {
            if (recorded.payload.type !== 'EngineEventRecorded' || recorded.payload.event.type !== 'domain_event')
                continue;
            const ev = recorded.payload.event;
            for (const actor of Object.values(currentWorld.actors)) {
                const observer = actor.id !== ev.ownerActorId;
                const actionIds = actor.capabilities.actionIds.filter(id => {
                    const action = catalog.getAction(id), trigger = (action?.mechanics.activation as Record<string, unknown> | undefined)?.trigger as Record<string, unknown> | undefined;
                    return !!action && triggerOwner(action) === 'world' && hasReactionTrigger(action, ev.event.kind) && (!observer || trigger?.observer_range_ft !== undefined && trigger?.target_event === 'source');
                });
                if (!actionIds.length)
                    continue;
                const declaration = command as unknown as {
                    facts?: SpatialFacts;
                    factsByTarget?: Record<string, SpatialFacts>;
                };
                const previous = originalWorld.pendingResolution as unknown as {
                    facts?: SpatialFacts;
                    opportunity?: {
                        facts?: SpatialFacts;
                    };
                } | null;
                const targetActorId = observer ? String(ev.event.data?.sourceActorId ?? ev.targetActorId ?? '') : ev.targetActorId;
                const observation = actor.character.spatialObservations?.nearby.find(row => row.actorId === targetActorId);
                const observerFacts: SpatialFacts | undefined = observation ? { factsSource: 'board', boardRevision: actor.character.spatialObservations!.boardRevision, distanceFt: observation.distanceFt,
                    relation: observation.relation, cover: observation.cover ?? 'none', lineOfSight: observation.lineOfSight === true,
                    canSeeTarget: observation.canSeeTarget === true, targetCanSeeSource: observation.targetCanSeeSource === true } : undefined;
                const facts = observer ? observerFacts : declaration.facts ?? (ev.targetActorId ? declaration.factsByTarget?.[ev.targetActorId] : undefined)
                    ?? declaration.factsByTarget?.[ev.ownerActorId] ?? previous?.facts ?? previous?.opportunity?.facts;
                const opportunity: QueuedEventReaction = { id: env.nextId(), actorId: actor.id, targetActorId, event: ev.event, actionIds,
                    ...(facts ? { facts: JSON.parse(JSON.stringify(facts)) as SpatialFacts } : {}) };
                if (services.options(currentWorld, opportunity, catalog).length)
                    queue.push(opportunity);
            }
        }
    };
    append(execution);
    const result: EventInput[] = [];
    if (!currentWorld.pendingResolution) {
        for (let count = 0; queue.length && !currentWorld.pendingResolution; count++) {
            if (count >= 128)
                throw Error('Event action cascade exceeded its budget');
            const opportunity = queue.shift()!, options = services.options(currentWorld, opportunity, catalog);
            if (!options.length)
                continue;
            const automatic = options.find(option => {
                const activation = catalog.getAction(option.actionId)?.mechanics.activation as Record<string, unknown> | undefined;
                return activation?.mode === 'triggered' && activation.optional === false;
            });
            if (automatic) {
                const changes = services.executeAutomatic(currentWorld, opportunity, automatic);
                if (!changes)
                    continue;
                result.push(...changes);
                currentWorld = foldEvents(currentWorld, changes.map((event, ordinal) => ({ ...event, ordinal })));
                append(changes);
                continue;
            }
            result.push({ sourceActorId: opportunity.actorId, obligationIds: ['system:event-reaction'], payload: { type: 'ResolutionOpened', resolution: {
                        id: env.nextId(), type: 'event_reaction', openedByCommandId: command.commandId, openedAtRevision: world.revision + 1, deadlineLogicalClock: env.clock() + 60000,
                        opportunity, request: { id: env.nextId(), type: 'reaction', actorId: opportunity.actorId, trigger: { type: 'event', sourceActorId: opportunity.targetActorId ?? opportunity.actorId, eventKind: opportunity.event.kind }, options }
                    } } });
            break;
        }
    }
    if (JSON.stringify(queue) !== JSON.stringify(world.eventReactions ?? []))
        result.unshift({ sourceActorId: command.actorId, obligationIds: ['system:event-reaction'], payload: { type: 'EventReactionQueueChanged', queue } });
    return result;
}
