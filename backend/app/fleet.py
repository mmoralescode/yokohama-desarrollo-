"""Fleet-wide identifiers kept separate from any individual vehicle catalog."""

# The key is persisted on a vehicle, rather than inferred from a make/model.
# A Mazda-looking unit entered manually must not receive Mazda3 maintenance rules
# until an operator intentionally associates this documented catalog.
MAZDA3_CATALOG_KEY = "mazda3-mx.v0.1.0"
