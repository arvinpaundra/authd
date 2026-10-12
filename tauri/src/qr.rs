//! The QR seam. macOS has a real detector in Vision: it locates the code in the picture, at any
//! size, rotated or skewed, so nothing here has to rescale or hunt for it.

#[cfg(target_os = "macos")]
pub fn scan(image: &[u8]) -> Result<Option<String>, String> {
    use objc2::rc::Retained;
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{VNDetectBarcodesRequest, VNImageRequestHandler, VNRequest};

    let data = NSData::with_bytes(image);
    let request = unsafe { VNDetectBarcodesRequest::new() };
    let requests: Retained<NSArray<VNRequest>> =
        NSArray::from_retained_slice(&[Retained::into_super(Retained::into_super(
            request.clone(),
        ))]);

    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        &data,
        &NSDictionary::new(),
    );
    handler
        .performRequests_error(&requests)
        .map_err(|_| "That image could not be read.".to_string())?;

    let Some(results) = (unsafe { request.results() }) else {
        return Ok(None);
    };
    Ok(results
        .iter()
        .find_map(|observation| unsafe { observation.payloadStringValue() })
        .map(|payload| payload.to_string()))
}

#[cfg(not(target_os = "macos"))]
pub fn scan(_image: &[u8]) -> Result<Option<String>, String> {
    Err("Reading QR codes isn't supported on this platform yet.".to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_a_migration_qr() {
        let png = include_bytes!("../tests/fixtures/migration-qr.png");
        let payload = super::scan(png).unwrap().expect("a QR in the fixture");
        assert!(
            payload.starts_with("otpauth-migration://offline?data="),
            "{payload}"
        );
    }

    #[test]
    fn finds_nothing_in_a_blank_image() {
        let png = include_bytes!("../icons/32x32.png");
        assert_eq!(super::scan(png).unwrap(), None);
    }
}
