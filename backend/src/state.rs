use crate::{config::Config, ws::hub::Hub};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub hub: Arc<Hub>,
}
