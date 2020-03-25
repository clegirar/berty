package protocoldb

import (
	"berty.tech/berty/v2/go/internal/gormutil"
	"berty.tech/berty/v2/go/internal/protocoldb/migrations"
	"github.com/jinzhu/gorm"
	"go.uber.org/zap"
)

// Init configures an active gorm connection
func Init(db *gorm.DB, logger *zap.Logger) (*gorm.DB, error) {
	return gormutil.Init(db, logger)
}

// Migrate runs migrations
func Migrate(db *gorm.DB, forceViaMigrations bool) error {
	return gormutil.Migrate(db, migrations.GetMigrations(), AllModels(), forceViaMigrations)
}

// InitMigrate is an alias for Init() and Migrate()
func InitMigrate(db *gorm.DB, logger *zap.Logger) (*gorm.DB, error) {
	db, err := Init(db, logger)
	if err != nil {
		return nil, err
	}

	err = Migrate(db, false)
	if err != nil {
		return nil, err
	}

	return db, nil
}

// DropDatabase drops all the tables of a database
func DropDatabase(db *gorm.DB) error {
	return gormutil.DropDatabase(db, AllTables())
}
