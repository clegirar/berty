import pickBy from 'lodash/pickBy'
import mapValues from 'lodash/mapValues'

import beapi from '@berty-tech/api'
import {
	initialState,
	isExpectedAppStateChange,
	MessengerActions,
	MessengerAppState,
	MsgrState,
} from './context'
import { ParsedInteraction } from '@berty-tech/store/types.gen'
import { pbDateToNum } from '@berty-tech/components/helpers'

export declare type reducerAction = {
	type: beapi.messenger.StreamEvent.Type | MessengerActions
	payload?: any
	name?: string
}

const mergeInteractions = (existing: Array<ParsedInteraction>, toAdd: Array<ParsedInteraction>) => {
	// This function expects both args to be sorted by sentDate descending
	if (toAdd.length === 0) {
		return existing || []
	}

	if (existing.length === 0) {
		return toAdd || []
	}

	if (toAdd.length === 1 && existing[0].cid === toAdd[0].cid) {
		return toAdd.concat(existing.slice(1))
	}

	if (
		pbDateToNum(existing[0].sentDate) <= pbDateToNum(toAdd[toAdd.length - 1].sentDate) &&
		existing[0].cid !== toAdd[toAdd.length - 1].cid
	) {
		return toAdd.concat(existing)
	}

	if (
		pbDateToNum(existing[existing.length - 1].sentDate) >= pbDateToNum(toAdd[0].sentDate) &&
		existing[existing.length - 1].cid !== toAdd[0].cid
	) {
		return existing.concat(toAdd)
	}

	// existing and entries to add seems to overlap
	existing = existing.slice()
	let i = 0
	while (toAdd.length > 0) {
		const newItem = toAdd.shift()
		if (newItem === undefined) {
			continue
		}

		while (
			i < existing.length &&
			pbDateToNum(existing[i].sentDate) > pbDateToNum(newItem.sentDate)
		) {
			i++
		}
		if (i < existing.length) {
			continue
		}

		if (existing[i] && existing[i].cid === newItem.cid) {
			existing[i] = newItem
		} else {
			existing.splice(i, 0, newItem)
		}
	}

	return existing
}

const applyAcksToInteractions = (interactions: ParsedInteraction[], acks: ParsedInteraction[]) => {
	for (let ack of acks) {
		const found = interactions.find((value) => value.cid === ack.targetCid)
		if (found === undefined) {
			continue
		}

		found.acknowledged = true
	}

	return interactions
}

const sortInteractions = (interactions: ParsedInteraction[]) =>
	interactions.sort((a, b) => pbDateToNum(b.sentDate) - pbDateToNum(a.sentDate))

const parseInteractions = (rawInteractions: beapi.messenger.Interaction[]) =>
	rawInteractions
		.map(
			(i: beapi.messenger.Interaction): ParsedInteraction => {
				const typeName = Object.keys(beapi.messenger.AppMessage.Type).find(
					(name) => beapi.messenger.AppMessage.Type[name as any] === i.type,
				)
				const name = typeName?.substr('Type'.length)
				const pbobj = (beapi.messenger.AppMessage as any)[name as any]

				if (!pbobj) {
					return {
						...i,
						type: beapi.messenger.AppMessage.Type.Undefined,
						payload: undefined,
					}
				}

				return {
					...i,
					payload: pbobj.decode(i.payload),
				}
			},
		)
		.filter((i: ParsedInteraction) => i.payload !== undefined)

const newestMeaningfulInteraction = (interactions: ParsedInteraction[]) =>
	interactions.find((i) => i.type === beapi.messenger.AppMessage.Type.TypeUserMessage)

export const reducerActions: {
	[key: string]: (oldState: MsgrState, action: reducerAction) => MsgrState
} = {
	[beapi.messenger.StreamEvent.Type.TypeConversationUpdated]: (oldState, action) => {
		const interactionsRewrite: { [key: string]: ParsedInteraction[] } = {}

		if (!action.payload.conversation.isOpen) {
			const newestInteraction = newestMeaningfulInteraction(
				oldState.interactions[action.payload.conversation.publicKey] || [],
			)

			if (newestInteraction) {
				interactionsRewrite[action.payload.conversation.publicKey] = [newestInteraction]
			}
		}

		return {
			...oldState,
			conversations: {
				...oldState.conversations,
				[action.payload.conversation.publicKey]: action.payload.conversation,
			},
			interactions: {
				...oldState.interactions,
				...interactionsRewrite,
			},
		}
	},

	[beapi.messenger.StreamEvent.Type.TypeAccountUpdated]: (oldState, action) => ({
		...oldState,
		account: action.payload.account,
	}),

	[beapi.messenger.StreamEvent.Type.TypeContactUpdated]: (oldState, action) => ({
		...oldState,
		contacts: {
			...oldState.contacts,
			[action.payload.contact.publicKey]: action.payload.contact,
		},
	}),

	[beapi.messenger.StreamEvent.Type.TypeMediaUpdated]: (oldState, action) => ({
		...oldState,
		medias: {
			...oldState.medias,
			[action.payload.media.cid]: action.payload.media,
		},
	}),

	[beapi.messenger.StreamEvent.Type.TypeMemberUpdated]: (oldState, action) => {
		const member = action.payload.member

		return {
			...oldState,
			members: {
				...oldState.members,
				[member.conversationPublicKey]: {
					...(oldState.members[member.conversationPublicKey] || {}),
					[member.publicKey]: member,
				},
			},
		}
	},

	[beapi.messenger.StreamEvent.Type.TypeInteractionDeleted]: (oldState, _) => {
		// const { [action.payload.cid]: _, ...withoutDeletedInteraction } = oldState.interactions
		// previous code was likely failing
		// TODO: add relevant conversation to payload along cid

		return {
			...oldState,
			interactions: {
				...oldState.interactions,
			},
		}
	},

	[beapi.messenger.StreamEvent.Type.TypeListEnded]: (oldState, _) => ({
		...oldState,
		initialListComplete: true,
	}),

	[beapi.messenger.StreamEvent.Type.TypeConversationPartialLoad]: (oldState, action) => {
		const gpk = action.payload.conversationPk
		const rawInteractions: Array<beapi.messenger.Interaction> = action.payload.interactions || []
		const medias: Array<beapi.messenger.Media> = action.payload.medias || []

		const interactions = sortInteractions(parseInteractions(rawInteractions))
		const mergedInteractions = mergeInteractions(
			oldState.interactions[gpk] || [],
			interactions.filter((i) => i.type !== beapi.messenger.AppMessage.Type.TypeAcknowledge),
		)

		const ackInteractions = interactions.filter(
			(i) => i.type === beapi.messenger.AppMessage.Type.TypeAcknowledge,
		)

		return {
			...oldState,
			interactions: {
				...oldState.interactions,
				[gpk]: applyAcksToInteractions(mergedInteractions, ackInteractions),
			},
			medias: {
				...oldState.medias,
				...medias.reduce<{ [key: string]: beapi.messenger.Media }>(
					(all, m) => ({
						...all,
						[m.cid]: m,
					}),
					{},
				),
			},
		}
	},

	[beapi.messenger.StreamEvent.Type.TypeInteractionUpdated]: (oldState, action) => {
		return reducerActions[beapi.messenger.StreamEvent.Type.TypeConversationPartialLoad](oldState, {
			...action,
			payload: {
				conversationPk: action.payload.interaction.conversationPublicKey,
				interactions: [action.payload.interaction],
			},
		})
	},

	[MessengerActions.SetStreamError]: (oldState, action) => ({
		...oldState,
		streamError: action.payload.error,
	}),

	[MessengerActions.AddFakeData]: (oldState, action) => {
		let fakeInteractions: { [key: string]: any[] } = {}
		for (const inte of action.payload.interactions || []) {
			if (!fakeInteractions[inte.conversationPublicKey]) {
				fakeInteractions[inte.conversationPublicKey] = []

				fakeInteractions[inte.conversationPublicKey].push(inte)
			}
		}

		return {
			...oldState,
			conversations: { ...oldState.conversations, ...action.payload.conversations },
			contacts: { ...oldState.contacts, ...action.payload.contacts },
			interactions: { ...oldState.interactions, ...fakeInteractions },
			members: { ...oldState.members, ...action.payload.members },
		}
	},

	[MessengerActions.DeleteFakeData]: (oldState, _) => ({
		...oldState,
		conversations: pickBy(oldState.conversations, (conv) => !(conv as any).fake),
		contacts: pickBy(oldState.contacts, (contact) => !(contact as any).fake),
		// TODO:
		// interactions: mapValues(oldState.interactions, (intes) =>
		// 	pickBy(intes, (inte) => !(inte as any).fake),
		// ),
		members: mapValues(oldState.members, (members) =>
			pickBy(members, (member) => !(member as any).fake),
		),
	}),

	[MessengerActions.SetDaemonAddress]: (oldState, action) => ({
		...oldState,
		daemonAddress: action.payload.value,
	}),

	[MessengerActions.SetPersistentOption]: (oldState, action) => ({
		...oldState,
		persistentOptions: action.payload,
	}),

	[MessengerActions.SetStateOpeningListingEvents]: (oldState, action) => ({
		...oldState,
		client: action.payload.messengerClient || oldState.client,
		protocolClient: action.payload.protocolClient || oldState.protocolClient,
		clearClients: action.payload.clearClients || oldState.clearClients,
		appState: MessengerAppState.OpeningListingEvents,
	}),

	[MessengerActions.SetStateClosed]: (oldState, _) => {
		const ret = {
			...initialState,
			accounts: oldState.accounts,
			embedded: oldState.embedded,
			daemonAddress: oldState.daemonAddress,
			isNewAccount: oldState.isNewAccount,
			appState: MessengerAppState.Closed,
			nextSelectedAccount: oldState.embedded ? oldState.nextSelectedAccount : '0',
		}

		if (ret.nextSelectedAccount !== null) {
			return reducer(ret, { type: MessengerActions.SetStateOpening })
		}

		return ret
	},

	[MessengerActions.SetStateOnBoarding]: (oldState, _) => ({
		...oldState,
		appState: oldState.account ? MessengerAppState.OnBoarding : oldState.appState,
	}),

	[MessengerActions.SetNextAccount]: (oldState, action) => {
		if (
			action.payload === null ||
			action.payload === undefined ||
			!oldState.embedded ||
			action.payload === oldState.selectedAccount
		) {
			return oldState
		}

		const ret = {
			...oldState,
			nextSelectedAccount: action.payload,
			isNewAccount: null,
		}

		return reducer(ret, { type: MessengerActions.SetStateClosed })
	},

	[MessengerActions.SetStateOpening]: (oldState, _action) => {
		if (oldState.nextSelectedAccount === null) {
			return oldState
		}
		return {
			...oldState,
			selectedAccount: oldState.nextSelectedAccount,
			nextSelectedAccount: null,
			appState: oldState.embedded
				? MessengerAppState.OpeningWaitingForDaemon
				: MessengerAppState.OpeningWaitingForClients,
		}
	},

	[MessengerActions.SetStateOpeningClients]: (oldState, _action) => ({
		...oldState,
		appState: MessengerAppState.OpeningWaitingForClients,
	}),

	[MessengerActions.SetStateOpeningGettingLocalSettings]: (oldState, _action) => ({
		...oldState,
		appState: MessengerAppState.OpeningGettingLocalSettings,
	}),

	[MessengerActions.SetStateOpeningMarkConversationsClosed]: (oldState, _) => ({
		...oldState,
		appState: MessengerAppState.OpeningMarkConversationsAsClosed,
	}),

	[MessengerActions.SetStateReady]: (oldState, _) => ({
		...oldState,
		appState:
			(Object.keys(oldState.accounts).length === 1 &&
				(!oldState.account || !oldState.account.displayName)) ||
			oldState.isNewAccount
				? MessengerAppState.GetStarted
				: MessengerAppState.Ready,
		isNewAccount: null,
	}),

	[MessengerActions.SetAccounts]: (oldState, action) => ({
		...oldState,
		accounts: action.payload,
	}),

	[MessengerActions.BridgeClosed]: (oldState, _) => {
		if (oldState.appState === MessengerAppState.DeletingClosingDaemon) {
			return {
				...oldState,
				appState: MessengerAppState.DeletingClearingStorage,
			}
		}
		return reducer(oldState, { type: MessengerActions.SetStateClosed })
	},

	[MessengerActions.AddNotificationInhibitor]: (oldState, action) => {
		if (oldState.notificationsInhibitors.includes(action.payload.inhibitor)) {
			return oldState
		}
		return {
			...oldState,
			notificationsInhibitors: [...oldState.notificationsInhibitors, action.payload.inhibitor],
		}
	},

	[MessengerActions.RemoveNotificationInhibitor]: (oldState, action) => {
		if (!oldState.notificationsInhibitors.includes(action.payload.inhibitor)) {
			return oldState
		}
		return {
			...oldState,
			notificationsInhibitors: oldState.notificationsInhibitors.filter(
				(inh) => inh != action.payload.inhibitor,
			),
		}
	},

	[beapi.messenger.StreamEvent.Type.TypeDeviceUpdated]: (oldState, __) => {
		console.info('ignored event type TypeDeviceUpdated')
		return oldState
	},

	[MessengerActions.SetCreatedAccount]: (oldState, action) => {
		return reducer(
			{
				...oldState,
				nextSelectedAccount: action?.payload?.accountId,
				isNewAccount: true,
				appState: MessengerAppState.OpeningWaitingForClients,
			},
			{ type: MessengerActions.SetStateClosed },
		)
	},

	[MessengerActions.SetStateStreamInProgress]: (oldState, action) => ({
		...oldState,
		streamInProgress: action.payload,
	}),

	[MessengerActions.SetStateStreamDone]: (oldState, _) => ({
		...oldState,
		appState: MessengerAppState.StreamDone,
		streamInProgress: null,
	}),
}

export const reducer = (oldState: MsgrState, action: reducerAction): MsgrState => {
	if (reducerActions[action.type]) {
		const newState = reducerActions[action.type](oldState, action)

		if (!isExpectedAppStateChange(oldState.appState, newState.appState)) {
			console.warn(`unexpected app state change from ${oldState.appState} to ${newState.appState}`)
		}

		return newState
	}

	console.warn('Unknown action type', action.type)
	return oldState
}
