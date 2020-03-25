package orbitutil

import (
	"context"

	"berty.tech/berty/v2/go/internal/account"
	"berty.tech/berty/v2/go/internal/bertycrypto"
	"berty.tech/berty/v2/go/pkg/bertyprotocol"
	"berty.tech/berty/v2/go/pkg/errcode"
	ipfslog "berty.tech/go-ipfs-log"
	"berty.tech/go-ipfs-log/identityprovider"
	"berty.tech/go-orbit-db/address"
	"berty.tech/go-orbit-db/iface"
	"berty.tech/go-orbit-db/stores"
	"berty.tech/go-orbit-db/stores/basestore"
	"berty.tech/go-orbit-db/stores/operation"
	coreapi "github.com/ipfs/interface-go-ipfs-core"
	"github.com/libp2p/go-libp2p-core/crypto"
)

const GroupMessageStoreType = "berty_group_messages"

type MessageStoreImpl struct {
	basestore.BaseStore

	acc *account.Account
	mk  bertycrypto.MessageKeys
	g   *bertyprotocol.Group
}

func (m *MessageStoreImpl) openMessage(ctx context.Context, e ipfslog.Entry) (*bertyprotocol.GroupMessageEvent, error) {
	if e == nil {
		return nil, errcode.ErrInvalidInput
	}

	op, err := operation.ParseOperation(e)
	if err != nil {
		// TODO: log
		return nil, err
	}

	headers, payload, decryptInfo, err := bertycrypto.OpenEnvelope(ctx, m.mk, m.g, op.GetValue(), e.GetHash())
	if err != nil {
		// TODO: log
		return nil, err
	}

	eventContext, err := bertyprotocol.NewEventContext(e.GetHash(), e.GetNext(), m.g)
	if err != nil {
		// TODO: log
		return nil, err
	}

	ownPK := crypto.PubKey(nil)
	md, inErr := m.acc.MemberDeviceForGroup(m.g)
	if inErr == nil {
		ownPK = md.Device.GetPublic()
	}

	if inErr = bertycrypto.PostDecryptActions(ctx, m.mk, decryptInfo, m.g, ownPK, headers); inErr != nil {
		err = errcode.ErrSecretKeyGenerationFailed.Wrap(err)
	}

	return &bertyprotocol.GroupMessageEvent{
		EventContext: eventContext,
		Headers:      headers,
		Message:      payload,
	}, err
}

func (m *MessageStoreImpl) ListMessages(ctx context.Context) (<-chan *bertyprotocol.GroupMessageEvent, error) {
	out := make(chan *bertyprotocol.GroupMessageEvent)
	ch := make(chan ipfslog.Entry)

	go func() {
		for e := range ch {
			evt, err := m.openMessage(ctx, e)
			if err != nil {
				// TODO: log
				continue
			}

			out <- evt
		}

		close(out)
	}()

	go func() {
		_ = m.OpLog().Iterator(&ipfslog.IteratorOptions{}, ch)
		// TODO: log
	}()

	return out, nil
}

func (m *MessageStoreImpl) AddMessage(ctx context.Context, payload []byte) (operation.Operation, error) {
	md, err := m.acc.MemberDeviceForGroup(m.g)
	if err != nil {
		return nil, errcode.ErrInternal.Wrap(err)
	}

	env, err := bertycrypto.SealEnvelope(ctx, m.mk, m.g, md.Device, payload)
	if err != nil {
		return nil, errcode.ErrCryptoEncrypt.Wrap(err)
	}

	op := operation.NewOperation(nil, "ADD", env)

	e, err := m.AddOperation(ctx, op, nil)
	if err != nil {
		return nil, errcode.ErrOrbitDBAppend.Wrap(err)
	}

	op, err = operation.ParseOperation(e)
	if err != nil {
		return nil, errcode.ErrOrbitDBDeserialization.Wrap(err)
	}

	return op, nil
}

func ConstructorFactoryGroupMessage(s *bertyOrbitDB) iface.StoreConstructor {
	return func(ctx context.Context, ipfs coreapi.CoreAPI, identity *identityprovider.Identity, addr address.Address, options *iface.NewStoreOptions) (iface.Store, error) {
		g, err := s.getGroupFromOptions(options)
		if err != nil {
			return nil, errcode.ErrInvalidInput.Wrap(err)
		}

		store := &MessageStoreImpl{
			acc: s.account,
			mk:  s.mk,
			g:   g,
		}

		options.Index = basestore.NewBaseIndex

		if err := store.InitBaseStore(ctx, ipfs, identity, addr, options); err != nil {
			return nil, errcode.ErrOrbitDBInit.Wrap(err)
		}

		go func() {
			for e := range store.Subscribe(ctx) {
				entry := ipfslog.Entry(nil)

				switch evt := e.(type) {
				case *stores.EventWrite:
					entry = evt.Entry

				case *stores.EventReplicateProgress:
					entry = evt.Entry
				}

				if entry == nil {
					continue
				}

				messageEvent, err := store.openMessage(ctx, entry)
				if err != nil {
					// TODO: log
					continue
				}

				store.Emit(ctx, messageEvent)
			}
		}()

		return store, nil
	}
}

var _ MessageStore = (*MessageStoreImpl)(nil)
